; Inno Setup script for the BloomBridge desktop app (Windows x64).
;
; Driven by scripts/build-installer.mjs, which passes:
;   /DAppVersion=<x.y.z>   /DAppExe=<neu exe filename>
;   /DStageDir=<abs path to the assembled install image>
;   /DOutDir=<abs path for the produced Setup.exe>
;
; Per-user install (no admin / UAC) into %LOCALAPPDATA%\BloomBridge, so the app dir
; is writable — Neutralino writes its log/.tmp there, and the shortcut's WorkingDir
; makes NL_CWD resolve to the install dir (which boot.js uses to find node.exe).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef AppExe
  #define AppExe "bloombridge-app-win_x64.exe"
#endif
#ifndef StageDir
  #define StageDir "stage"
#endif
#ifndef OutDir
  #define OutDir "installer-out"
#endif

#define MyAppName "BloomBridge"
#define MyAppPublisher "SIL"
#define MyAppURL "https://github.com/sillsdev/BloomBridge"

[Setup]
; Stable per-app GUID (do not change between versions — drives upgrade detection).
AppId={{8F3A1C2E-5B7D-4E9A-9C1F-2A6B3D4E5F60}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={localappdata}\BloomBridge
; Fixed per-user location — never prompt for it. DisableDirPage also suppresses the
; "folder already exists, install anyway?" confirmation when upgrading in place.
DisableDirPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
DisableProgramGroupPage=yes
DisableFinishedPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
; Auto-update path: the running app launches this installer over itself. Use the
; Restart Manager to close BloomBridge (which holds node.exe + the neu exe) before
; copying files, then relaunch it when done — so updates are seamless.
CloseApplications=yes
RestartApplications=yes
OutputDir={#OutDir}
OutputBaseFilename=BloomBridge-Setup-{#AppVersion}
SetupIconFile={#StageDir}\appIcon.ico
UninstallDisplayIcon={app}\appIcon.ico
UninstallDisplayName={#MyAppName} {#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
; The entire assembled install image (neu exe + resources.neu + node.exe + app/).
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; IconFilename: "{app}\appIcon.ico"

[Run]
; Auto-launch after install without prompting (no postinstall checkbox).
Filename: "{app}\{#AppExe}"; Description: "Launch {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait skipifsilent
