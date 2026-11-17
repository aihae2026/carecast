#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef BuildVersion
  #define BuildVersion "dev"
#endif

[Setup]
AppId={{2977066B-80B2-47F9-B5C8-CE6CD11D570A}
AppName=CareCast AI
AppVersion={#BuildVersion}
AppPublisher=CareCast AI
; 아이콘은 `npm run package:installer` 가 `scripts/make-icon.cjs` 로 먼저 만든다.
; 없으면 Inno 기본 아이콘(아래 화살표)이 붙어 바탕화면에서 무엇인지 알 수 없다.
; 설치 파일만 **상자에서 나오는 얼굴**(carecast-setup.ico) — 받은 파일과 설치된 프로그램이 갈리게(사용자 지적 2026-09-18).
; 제거 목록·바로가기는 아래처럼 원래 얼굴(carecast.ico)이다. 둘 다 `scripts/make-icon.cjs` 가 만든다.
SetupIconFile=carecast-setup.ico
UninstallDisplayIcon={app}\carecast.ico
; 파일 속성에 뜨는 값. 서명이 없는 동안 사용자가 「이게 뭔지」 확인할 유일한 자리라
; 비워 두지 않는다. SmartScreen 경고 자체를 없애지는 못한다(그건 코드 서명의 몫이다).
VersionInfoCompany=CareCast AI
VersionInfoProductName=CareCast AI
VersionInfoDescription=CareCast AI 설치
VersionInfoVersion=1.0.0
DefaultDirName={localappdata}\Programs\CareCast
DefaultGroupName=CareCast AI
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=CareCast-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName=CareCast AI
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 CareCast 바로가기 만들기"; GroupDescription: "바로가기:"
Name: "autostart"; Description: "Windows에 로그인하면 CareCast 자동 시작"; GroupDescription: "시작 옵션:"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "CareCast-설치.bat"
Source: "carecast.ico"; DestDir: "{app}"; Flags: ignoreversion
; 휴대폰이 못 붙을 때 사람이 한 번 실행하는 파일. 설치 마법사는 사용자 권한이라
; 방화벽 규칙을 못 넣는다 — 이 파일이 스스로 권한을 올린다.
Source: "CareCast-방화벽-열기.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "carecast-start.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "CareCast-Start.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "CareCast-Stop.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\scripts\carecast-loop.template.bat"; DestDir: "{app}"; DestName: "carecast-loop.bat"; Flags: ignoreversion

[Icons]
Name: "{group}\CareCast AI"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\CareCast-Start.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\carecast.ico"
Name: "{group}\휴대폰 접속 허용(방화벽)"; Filename: "{app}\CareCast-방화벽-열기.bat"; WorkingDir: "{app}"; IconFilename: "{app}\carecast.ico"
Name: "{group}\CareCast 종료"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\CareCast-Stop.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\carecast.ico"; IconIndex: 0
Name: "{autodesktop}\CareCast AI"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\CareCast-Start.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\carecast.ico"; Tasks: desktopicon
Name: "{userstartup}\CareCast AI"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\CareCast-Start.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\carecast.ico"; Tasks: autostart

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\CareCast-Start.vbs"""; Description: "CareCast 실행 및 초기 설정 열기"; Flags: nowait postinstall skipifsilent

; DB, uploaded audio and .env are created after installation and are not listed
; in Files/UninstallDelete. Uninstall must preserve the facility's own data.

[Code]
function StopInstalledApp(): Boolean;
var
  ResultCode: Integer;
  StopScript: String;
begin
  StopScript := ExpandConstant('{app}\CareCast-Stop.ps1');
  Result := True;
  if FileExists(StopScript) then
    Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + StopScript + '"',
      ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

// 남은 기록이 있으면 묻는다 (사용자 신고 2026-09-17: 다시 깐 노트북에서 초기 설정이 안 떴다).
// 제거는 기관 기록을 남기므로, 다시 깔면 서버는 「쓰던 PC」로 읽는다. 사람이 고르게 한다.
// 새로 설치를 골라도 지우지 않는다 — db 폴더를 옆 이름으로 옮겨 두면 되돌릴 수 있다.
// 조용한 설치는 묻지 못하므로 기본은 유지, /FRESH=1 일 때만 새로 설치.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  DataDir, Backup: String;
  ResetData: Boolean;
  Choice: Integer;
begin
  Result := '';
  ResetData := False;
  DataDir := ExpandConstant('{app}\server\db');
  if FileExists(DataDir + '\database.db') then
  begin
    if WizardSilent() then
      ResetData := ExpandConstant('{param:FRESH|0}') = '1'
    else
    begin
      Choice := TaskDialogMsgBox('이 PC에 전에 쓰던 CareCast 기록이 남아 있습니다.',
        '설정·예약·방송 이력이 들어 있습니다. 어떻게 설치할까요?' + #13#10#13#10 +
        '새로 설치를 고르면 기록을 지우지 않고 옆 폴더(server\db-보관-날짜)로 옮겨 두고, 초기 설정부터 다시 시작합니다.',
        mbConfirmation, MB_YESNOCANCEL, ['기록을 그대로 두고 설치 (업데이트)', '새로 설치 (초기 설정부터)'], 0);
      if Choice = IDCANCEL then
      begin
        Result := '설치를 취소했습니다.';
        exit;
      end;
      ResetData := Choice = IDNO;
    end;
  end;
  if not StopInstalledApp() then
  begin
    Result := '실행 중인 CareCast를 종료하지 못했습니다. CareCast를 종료한 뒤 다시 설치해 주세요.';
    exit;
  end;
  if ResetData then
  begin
    Backup := ExpandConstant('{app}\server\db-보관-') + GetDateTimeString('yyyymmdd-hhnnss', #0, #0);
    Log('기존 기록 폴더를 옮김: ' + DataDir + ' -> ' + Backup);
    if not RenameFile(DataDir, Backup) then
      Result := '전에 쓰던 기록 폴더를 옮기지 못했습니다. 컴퓨터를 다시 켠 뒤 설치해 주세요.';
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    if not StopInstalledApp() then
      RaiseException('실행 중인 CareCast를 종료하지 못했습니다. 종료 후 다시 제거해 주세요.');
end;
