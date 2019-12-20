import classNames from "classnames";
import { Game, GameRecord } from "common/butlerd/messages";
import { formatDurationAsMessage } from "common/format/datetime";
import { fileSize } from "common/format/filesize";
import { DownloadWithProgress } from "main/drive-downloads";
import React from "react";
import { FormattedMessage } from "react-intl";
import { Button } from "renderer/basics/Button";
import { Icon } from "renderer/basics/Icon";
import { IconButton } from "renderer/basics/IconButton";
import { MenuTippy } from "renderer/basics/Menu";
import { ClickOutsideRefer } from "renderer/basics/useClickOutside";
import { ProgressBar } from "renderer/pages/ProgressBar";
import { InstallModalContents } from "renderer/Shell/InstallModal";

type ClickHandler = (ev: React.MouseEvent<HTMLButtonElement>) => Promise<void>;

interface Props {
  coref: ClickOutsideRefer;
  game: GameRecord;
  launch: ClickHandler;
  install: ClickHandler;
  purchase: ClickHandler;
  dl?: DownloadWithProgress;
  stopInstall: () => void;
  gameBeingInstalled?: Game;
}

export const GameGridItem = React.memo((props: Props) => {
  const {
    coref,
    game,
    dl,
    install,
    purchase,
    launch,
    stopInstall,
    gameBeingInstalled,
  } = props;

  let wrapInTippyIfNeeded = (content: JSX.Element): JSX.Element => {
    if (gameBeingInstalled?.id == game.id) {
      return (
        <MenuTippy
          placement="left-end"
          appendTo={document.body}
          content={
            <InstallModalContents
              ref={coref("install-modal-contents")}
              coref={coref}
              game={gameBeingInstalled}
              onClose={stopInstall}
            />
          }
          interactive
          visible
        >
          {content}
        </MenuTippy>
      );
    }
    return content;
  };

  return (
    <div
      className={classNames("item", { installed: !!game.installedAt })}
      data-game-id={game.id}
    >
      <a href={`itch://games/${game.id}`}>
        <div className="cover-container">
          <DownloadOverlay dl={dl} />
          {game.cover ? (
            <img className="cover" src={game.cover} />
          ) : (
            <div className="cover missing" />
          )}
        </div>
      </a>
      <div className="title">{game.title}</div>
      <div className="buttons">
        <div className="filler" />
        {game.owned ? null : (
          <IconButton icon="heart-filled" onClick={purchase} />
        )}

        {wrapInTippyIfNeeded(
          <InstallButton icon={!!game.installedAt} install={install} />
        )}
        {game.installedAt && (
          <Button icon="play2" label="Launch" onClick={launch} />
        )}
      </div>
    </div>
  );
});

const DownloadOverlay = (props: { dl?: DownloadWithProgress }) => {
  const { dl } = props;
  if (!dl || dl.finishedAt) {
    return null;
  }
  const { progress } = dl;

  return (
    <div className="download-overlay">
      {progress ? (
        <>
          <ProgressBar progress={progress.progress} />
          <div>
            {fileSize(progress.bps)} / s &mdash;{" "}
            <FormattedMessage {...formatDurationAsMessage(progress.eta)} />{" "}
          </div>
        </>
      ) : (
        <Icon icon="stopwatch" />
      )}
    </div>
  );
};

const InstallButton = React.forwardRef(
  (props: { icon: boolean; install: ClickHandler }, ref: any) => {
    const { icon, install } = props;

    if (icon) {
      return <IconButton ref={ref} icon="install" onClick={install} />;
    } else {
      return (
        <Button
          ref={ref}
          icon="install"
          label="Install"
          onClick={install}
          secondary
        />
      );
    }
  }
);
