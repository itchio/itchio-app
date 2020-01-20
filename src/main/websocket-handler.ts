import {
  Client,
  Conversation,
  IDGenerator,
  NotificationCreator,
  Request,
  RequestCreator,
  RequestError,
  RpcError,
  RpcResult,
} from "butlerd";
import { Download } from "common/butlerd/messages";
import { Packet, PacketCreator, packets } from "common/packets";
import { queries, QueryCreator } from "common/queries";
import dump from "common/util/dump";
import { shell } from "electron";
import { MainState } from "main";
import { envSettings } from "main/constants/env-settings";
import { loadLocale, setPreferences } from "main/load-preferences";
import { mainLogger } from "main/logger";
import { setProfile } from "main/profile";
import { registerQueriesLaunch } from "main/queries-launch";
import WebSocket from "ws";
import _ from "lodash";
import { messages } from "common/butlerd";
import { filterObject } from "common/filter-object";

const logger = mainLogger.childWithName("websocket-handler");

export function broadcastPacket<T>(
  ms: MainState,
  pc: PacketCreator<T>,
  payload: T
) {
  const msg = pc(payload);
  if (envSettings.verboseWebSocket) {
    logger.debug(`*- ${dump(msg)}`);
  }
  const text = JSON.stringify(msg);

  let ws = ms.websocket;
  if (ws) {
    for (const cx of ws.sockets) {
      cx.sendText(text);
    }
  } else {
    mainLogger.warn(`Can't broadcast yet, websocket isn't up`);
  }
}

export class WebsocketContext {
  constructor(private socket: WebSocket) {}

  reply<T>(pc: PacketCreator<T>, payload: T, silent?: boolean) {
    let msg = pc(payload);
    if (!silent && envSettings.verboseWebSocket) {
      logger.debug(`<- ${dump(msg)}`);
    }
    this.sendObject(msg);
  }

  sendObject(msg: Object) {
    this.sendText(JSON.stringify(msg));
  }

  sendText(text: string) {
    this.socket.send(text);
  }
}

export type PacketHandler<T> = (cx: WebsocketContext, payload: T) => void;
export type QueryHandler<Params, Result> = (params: Params) => Promise<Result>;

export type OnPacket = <T>(pc: PacketCreator<T>, f: PacketHandler<T>) => void;
export type OnQuery = <Params, Result>(
  qc: QueryCreator<Params, Result>,
  f: QueryHandler<Params, Result>
) => void;

type Inbound = {
  resolve: (payload: any) => void;
  reject: (e: RpcError) => void;
};

type OngoingConversation = {
  conv: Conversation;
  idSeed: number;
  inbound: { [id: number]: Inbound };
};

export class WebsocketHandler {
  packetHandlers: {
    [type: string]: PacketHandler<any>;
  } = {};

  queryHandlers: {
    [method: string]: QueryHandler<any, any>;
  } = {};

  ongoingConversations: {
    [id: string]: OngoingConversation;
  } = {};

  constructor(ms: MainState) {
    let onPacket: OnPacket = (pc, f) => {
      this.packetHandlers[pc.__type] = f;
    };

    let onQuery: OnQuery = (qc, f) => {
      this.queryHandlers[qc.__method] = f;
    };

    onQuery(queries.minimize, async () => {
      let win = ms.browserWindow;
      if (win) {
        win.minimize();
      }
    });

    onQuery(queries.toggleMaximized, async () => {
      let win = ms.browserWindow;
      if (win) {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });

    onQuery(queries.close, async () => {
      let win = ms.browserWindow;
      if (win) {
        win.close();
      }
    });

    onQuery(queries.isMaximized, async () => {
      let maximized = false;
      let win = ms.browserWindow;
      if (win) {
        maximized = win.isMaximized();
      }
      return { maximized };
    });

    onQuery(queries.getDownloads, async () => {
      return { downloads: ms.downloads ?? {} };
    });

    onQuery(queries.getDownloadsForGame, async ({ gameId }) => {
      return {
        downloads: filterObject(ms.downloads ?? {}, d => d.game?.id === gameId),
      };
    });

    onQuery(queries.getProfile, async () => {
      return { profile: ms.profile };
    });
    onQuery(queries.setProfile, async params => {
      await setProfile(ms, params);
    });

    onQuery(queries.getWebviewState, async () => {
      return { state: ms.webview };
    });
    onQuery(queries.setWebviewState, async params => {
      ms.webview = params.state;
    });

    onQuery(queries.getCurrentLocale, async params => {
      return {
        currentLocale: ms.localeState!.current,
      };
    });
    onQuery(queries.switchLanguage, async params => {
      const { lang } = params;
      await loadLocale(ms, lang);
      broadcastPacket(ms, packets.currentLocaleChanged, {
        currentLocale: ms.localeState!.current,
      });
      await setPreferences(ms, { lang });
    });

    onQuery(queries.openExternalURL, async ({ url }) => {
      shell.openExternal(url);
    });

    registerQueriesLaunch(ms, onQuery);

    onQuery(queries.uninstallGame, async ({ cave }) => {
      if (!ms.butler) {
        throw new Error("butler is offline");
      }

      let client = new Client(ms.butler.endpoint);
      await client.call(messages.UninstallPerform, {
        caveId: cave.id,
      });
      broadcastPacket(ms, packets.gameUninstalled, {
        caveId: cave.id,
        uploadId: cave.upload.id,
        gameId: cave.game.id,
      });
    });

    onQuery(queries.openDevTools, async () => {
      if (!ms.browserWindow) {
        throw new Error("browser window doesn't exist");
      }

      ms.browserWindow.webContents.openDevTools({ mode: "detach" });
    });

    onPacket(packets.queryRequest, (cx, req) => {
      let handler = this.queryHandlers[req.method];
      if (!handler) {
        console.warn(`Unhandled query: ${dump(req)}`);
        cx.reply(packets.queryResult, {
          state: "error",
          id: req.id,
          error: new Error(`Unhandled query ${req.method}`),
        });
        return;
      }

      handler(req.params)
        .then(result => {
          cx.reply(packets.queryResult, {
            state: "success",
            id: req.id,
            result,
          });
        })
        .catch(error => {
          console.warn(`Failed query: ${dump(req)}\n\nStack = ${error.stack}`);
          cx.reply(packets.queryResult, {
            state: "error",
            id: req.id,
            error,
          });
        });
    });

    onPacket(packets.butlerCancel, (cx, request) => {
      this.cancelConversation(request.conv);
    });

    onPacket(packets.butlerResult, (cx, payload) => {
      let ongoing = this.ongoingConversations[payload.conv];
      if (!ongoing) {
        logger.warn(
          `Got butler result for unknown conversation ${payload.conv}`
        );
        return;
      }

      if (typeof payload.res.id !== "number") {
        // drop notifications
        return;
      }

      let inbound = ongoing.inbound[payload.res.id];
      if (!inbound) {
        logger.warn(`Got butler result for unknown inbound ${payload.res.id}`);
        return;
      }
      delete ongoing.inbound[payload.res.id];

      if (payload.res.error) {
        inbound.reject(payload.res.error);
      } else {
        console.log(
          `Resolving inbound with payload.res.result, payload being: ${dump(
            payload
          )}`
        );
        inbound.resolve(payload.res.result);
      }
    });

    onPacket(packets.butlerRequest, (cx, payload) => {
      if (!ms.butler) {
        let result: RpcResult<any> = {
          jsonrpc: "2.0",
          id: payload.req.id,
          error: {
            code: -32603,
            message: "butler is offline",
          },
        };
        cx.reply(packets.butlerResult, {
          conv: payload.conv,
          res: result,
        });
        return;
      }

      const req = payload.req;
      const rc = Object.assign(
        (params: any) => (gen: IDGenerator) => ({
          ...req,
          id: gen.generateID(),
        }),
        { __method: req.method }
      );

      let ongoing = this.ongoingConversations[payload.conv];
      let call: Promise<any>;

      if (ongoing) {
        call = ongoing.conv.call(rc, req.params);
      } else {
        let client = new Client(ms.butler.endpoint);
        call = client.call(rc, req.params, conv => {
          ongoing = { conv, inbound: {}, idSeed: 1 };
          this.ongoingConversations[payload.conv] = ongoing;
          if (payload.handled) {
            if (payload.handled.notifications) {
              for (const method of payload.handled.notifications) {
                let nc = { __method: method } as NotificationCreator<any>;
                conv.onNotification(nc, notif => {
                  cx.reply(packets.butlerNotification, {
                    conv: payload.conv,
                    notif,
                  });
                });
              }
            }

            if (payload.handled.requests) {
              for (const method of payload.handled.requests) {
                let rc = { __method: method } as RequestCreator<any, any>;
                conv.onRequest(rc, async params => {
                  let id = ongoing.idSeed;
                  ongoing.idSeed++;

                  let req: Request<any, any> = {
                    id,
                    method,
                    params,
                  };
                  cx.reply(packets.butlerRequest, {
                    conv: payload.conv,
                    req,
                  });

                  return await new Promise((resolve, reject) => {
                    ongoing.inbound[id] = { resolve, reject };
                  });
                });
              }
            }
          }
        });
      }

      call
        .then(originalResult => {
          let result: RpcResult<any> = {
            jsonrpc: "2.0",
            id: req.id,
            result: originalResult,
          };
          cx.reply(packets.butlerResult, {
            conv: payload.conv,
            res: result,
          });
        })
        .catch((error: RequestError) => {
          let rpcError = error.rpcError || {
            code: -32603,
            message: error.stack || error.message,
          };

          let result: RpcResult<any> = {
            jsonrpc: "2.0",
            id: req.id,
            error: rpcError,
          };
          cx.reply(packets.butlerResult, {
            conv: payload.conv,
            res: result,
          });
        });
    });
  }

  handle(cx: WebsocketContext, message: string) {
    let msg = JSON.parse(message) as Packet<any>;
    if (envSettings.verboseWebSocket) {
      logger.debug(`-> ${dump(msg)}`);
    }

    let ph = this.packetHandlers[msg.type];
    if (!ph) {
      console.warn(`Unhandled renderer packet: [[${msg}]]`);
      return;
    }
    ph(cx, msg.payload);
  }

  private cancelConversation(convID: string) {
    let ongoing = this.ongoingConversations[convID];
    if (!ongoing) {
      return;
    }
    ongoing.conv.cancel();
    delete this.ongoingConversations[convID];
  }
}