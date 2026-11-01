# Installing FinSight AI on your Mac

**Current status: an Intel candidate has passed local tests under Rosetta, but has not been tested on a separate clean Intel Mac. Gatekeeper rejected its current ad-hoc signature, and it is not notarized.** Arrange a supported first-install check with the sender before relying on it. Do not use the Apple Silicon development build.

## Before you start

The intended recipient is an **Intel Mac assumed to run macOS 26**. The bundled binaries declare macOS 14.0 as their minimum, but older OS versions have not been tested. Choose Apple menu → About This Mac and check the processor and macOS version. Not every Intel Mac can run macOS 26. If yours uses an older version, ask the sender for a compatible build; do not upgrade macOS just to try this installer without reviewing that separately.

You will not need to install Java, Python, PostgreSQL, Homebrew, Docker, VS Code or programming tools. The app includes its required runtimes. Your financial records stay on your own Mac and are independent of the sender's records.

## Install the validated Intel version

1. Receive `FinSight-AI-Installer.dmg` from the sender and confirm it is the tested Intel version.
2. Open the DMG.
3. Drag **FinSight AI** to the **Applications** shortcut.
4. If a FinSight AI app already exists, **stop**. Ask the sender before replacing it; it may use a different data layout.
5. Eject the DMG and open FinSight AI from Applications.
6. Wait while it prepares your private local database. Do not force quit during preparation.
7. Choose **Create Account**, select a username, and enter/confirm a password of at least twelve characters. Keep your password somewhere safe; there is no password-recovery screen.
8. Your account starts at $0.00, with standard categories and no financial history. Record your own opening balance/income/expenses as appropriate.

The current development build is not notarized. macOS may block it or show an unfamiliar-developer warning. Stop and contact the sender for the reviewed next step. Do not turn off Gatekeeper, run Terminal bypass commands or install developer tools to work around a warning. A warning-free first launch has not yet been verified.

## Daily use

Open the app from Applications and log in. Category suggestions are optional: review them and choose your own category. Forecasts show possible future balances; they are not payments or guarantees. Savings allocations track how you set money aside; they do not transfer money through your bank.

Quit normally when finished. Your records remain saved. You will log in again on reopening. An internet connection is not part of the intended normal workflow.

## Backups

The app keeps local backups while it is running and checks for missed backup slots when reopened. This distribution does not install a background LaunchAgent, so it cannot create backups while closed or while the Mac is off.

Local backups on the same Mac do not protect against losing the Mac. You may choose an external drive in Backup & Recovery; keep that drive and its copies private. Backups and exports are not encrypted by the app. “Restore From Backup” verifies a separate restored copy; it does not replace your live records.

## Updates and problems

Before an update, quit normally and retain a verified backup. Follow the sender's instructions for the same portable version family. Replacing the app is different from deleting its data.

Your portable data is under `~/Library/Application Support/FinSight AI Portable/`. Do not delete, move or rename that folder to fix an error. Never remove database files or backups to make startup succeed. If startup fails or a port is in use, retain the error message and ask the sender. Do not share your password, private configuration files, database files or financial screenshots in a public issue.


The prepared Intel candidate is version **0.6.2**, approximately **476 MB** (454 MiB). The app bundle and disk image passed local integrity checks; those checks do not replace macOS publisher/notarization approval. Until the sender resolves the first-launch approval route and verifies a clean Intel Mac, this is a candidate for guided testing, not an unattended installation recommendation.
