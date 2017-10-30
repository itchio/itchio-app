import { Watcher } from "./watcher";
import { DB } from "../db";

import fetchers from "./fetchers";
import preboot from "./preboot";
import preferences from "./preferences";
import mainWindow from "./main-window";
import locales from "./locales";
import tray from "./tray";
import menu from "./menu";
import installLocations from "./install-locations";
import selfUpdate from "./self-update";
import setup from "./setup";
import tabs from "./tabs";
import triggers from "./triggers";
import modals from "./modals";
import openAtLogin from "./open-at-login";
import proxy from "./proxy";
import login from "./login";
import dialogs from "./dialogs";
import i18n from "./i18n";
import contextMenu from "./context-menu";
import rememberedSessions from "./remembered-sessions";
import session from "./session";
import navigation from "./navigation";
import tabSave from "./tab-save";
import commons from "./commons";
import purchases from "./purchases";
import url from "./url";
import itchInternal from "./itch-internal";
import tasks from "./tasks";
import downloads from "./downloads";
import queueInstall from "./queue-install";
import queueLaunch from "./queue-launch";
import updater from "./updater";
import gameUpdates from "./game-updates";
import report from "./report";
import search from "./search";
import webContents from "./web-contents";
import notifications from "./notifications";

import { currentRuntime } from "../os/runtime";
const runtime = currentRuntime();

export default function getWatcher(db: DB) {
  const watcher = new Watcher();

  fetchers(watcher, db);
  preboot(watcher, db);
  preferences(watcher);
  mainWindow(watcher);
  locales(watcher);
  tray(watcher);
  menu(watcher, runtime);
  installLocations(watcher, db);
  selfUpdate(watcher);
  setup(watcher, db);
  tabs(watcher);
  triggers(watcher);
  modals(watcher);
  openAtLogin(watcher);
  proxy(watcher);
  login(watcher);
  dialogs(watcher, db);
  i18n(watcher);
  contextMenu(watcher, db);
  rememberedSessions(watcher);
  session(watcher);
  navigation(watcher);
  tabSave(watcher, db);
  commons(watcher, db);
  purchases(watcher);
  url(watcher);
  itchInternal(watcher);
  tasks(watcher, db);
  downloads(watcher, db);
  queueInstall(watcher, db);
  queueLaunch(watcher, db);
  updater(watcher, db);
  gameUpdates(watcher, db);
  report(watcher, db);
  search(watcher, db);
  webContents(watcher, db);
  notifications(watcher);

  watcher.validate();
  return watcher;
}