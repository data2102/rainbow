; ============================================================
;  레인보우 식스 클랜 통합 설치 파일
;  r6rank.co.kr
; ------------------------------------------------------------
;  이 파일은 "설계도"입니다. 실제 게임 파일은 들어있지 않습니다.
;  payload\game\ 안에 완성된 게임 폴더를 넣고 build.bat 을 실행하면
;  output\R6ClanSetup.exe 가 만들어집니다.
;
;  자세한 방법: installer\README.md
; ============================================================

#define AppName    "레인보우 식스 클랜"
#define AppVersion "1.0"
#define AppPublisher "r6rank.co.kr"
#define AppURL     "https://r6rank.co.kr"
#define GameExeName "RainbowSix.exe"

; 런쳐 파일들이 반드시 들어가야 하는 자리. r6launch.bat 이 이 경로를 전제로
; 동작하고, r6clan:// 등록도 이 경로를 가리킵니다.
#define ClanDir "C:\R6Clan"

; ---------- payload 에 무엇이 들어있는지 확인 ----------
; 게임 폴더가 비어 있어도 컴파일은 됩니다. 그 경우 "클랜 설정 전용"
; 설치 파일이 만들어집니다 (이미 게임이 깔린 사람에게 유용).
#define GameSrc AddBackslash(SourcePath) + "payload\game"
#if DirExists(GameSrc) && FileExists(AddBackslash(GameSrc) + GameExeName)
  #define HAVE_GAME
#else
  #pragma message "  [알림] payload\game\RainbowSix.exe 가 없습니다."
  #pragma message "         게임 없이 '클랜 설정 전용' 설치 파일로 만들어집니다."
#endif

#if FileExists(AddBackslash(CompilerPath) + "Languages\Korean.isl")
  #define HAVE_KOREAN
#endif


[Setup]
; 이 GUID 는 바꾸지 마세요. 재설치·업데이트를 같은 프로그램으로 인식하는 표시입니다.
AppId={{8E3C6F1A-4B27-4E9D-9A55-5C1A6D0E7B34}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
VersionInfoDescription={#AppName} 통합 설치
VersionInfoVersion=1.0.0.0

; 기본 설치 위치 — 원래 게임이 깔리던 자리 그대로.
; 64비트 윈도우에서 {commonpf} 는 "C:\Program Files (x86)" 입니다.
DefaultDirName={commonpf}\Red Storm Entertainment\Tom Clancy's Rainbow Six
DefaultGroupName=Rainbow Six
DisableProgramGroupPage=yes
AllowNoIcons=yes

; 방화벽 등록과 레지스트리 쓰기에 관리자 권한이 필요합니다.
PrivilegesRequired=admin

; 32비트 모드로 둡니다 — 1998년 게임이므로 Program Files (x86) 이 맞습니다.
; ArchitecturesInstallIn64BitMode 는 일부러 지정하지 않습니다.

OutputDir=output
OutputBaseFilename=R6ClanSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
#ifdef HAVE_GAME
UninstallDisplayIcon={app}\{#GameExeName}
#endif

; 설치 첫 화면과 마지막 화면에 띄울 안내
InfoBeforeFile=info-before.txt


[Languages]
#ifdef HAVE_KOREAN
Name: "ko"; MessagesFile: "compiler:Languages\Korean.isl"
#else
Name: "en"; MessagesFile: "compiler:Default.isl"
#endif


[Types]
Name: "full";   Description: "전체 설치 (권장)"
Name: "custom"; Description: "직접 선택"; Flags: iscustom


[Components]
#ifdef HAVE_GAME
Name: "game"; Description: "게임 본체 (패치·맵·스킨·타겟·사운드 모두 적용된 상태)"; Types: full custom
#endif
Name: "clan"; Description: "클랜 접속 설정 (사이트 버튼으로 게임 켜기 + 윈도우 방화벽 열기)"; Types: full custom


[Tasks]
#ifdef HAVE_GAME
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "추가 작업:"; Components: game
#endif


[Files]
#ifdef HAVE_GAME
; 완성된 게임 폴더를 통째로 옮깁니다. 하위 폴더 구조를 그대로 유지합니다.
Source: "payload\game\*"; DestDir: "{app}"; Excludes: "_README.txt"; \
    Flags: recursesubdirs createallsubdirs ignoreversion; Components: game
#endif

; 런쳐 파일 4종. 이 저장소의 public\ 에 있는 것을 그대로 씁니다.
; 설치가 끝난 뒤 [Code] 가 이 안의 게임 경로를 실제 설치 위치로 고쳐 씁니다.
Source: "..\public\r6launch.bat";     DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan
Source: "..\public\r6firewall.bat";   DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan
Source: "..\public\r6upnp.bat";       DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan
Source: "..\public\r6upnp-close.bat"; DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan


[Icons]
#ifdef HAVE_GAME
Name: "{group}\Rainbow Six";           Filename: "{app}\{#GameExeName}"; WorkingDir: "{app}"; Components: game
Name: "{group}\{#AppName} 제거";        Filename: "{uninstallexe}"
Name: "{autodesktop}\Rainbow Six";     Filename: "{app}\{#GameExeName}"; WorkingDir: "{app}"; Tasks: desktopicon
#endif


[Registry]
; ---------- 사이트의 버튼이 게임을 켤 수 있게 하는 등록 ----------
; HKA = 관리자 권한이면 HKLM, 아니면 HKCU. 이 설치 파일은 관리자로 도므로
; 이 PC 를 쓰는 모든 계정에 적용됩니다.
Root: HKA; Subkey: "Software\Classes\r6clan"; \
    ValueType: string; ValueName: ""; ValueData: "URL:R6 Clan Launcher"; \
    Flags: uninsdeletekey; Components: clan
Root: HKA; Subkey: "Software\Classes\r6clan"; \
    ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Components: clan
; 배치 파일 경로에 따옴표를 씌우지 않습니다.
; cmd 는 /c 뒤가 따옴표로 시작하면 맨 앞과 맨 뒤 따옴표를 떼어냅니다. 그러면
;   C:\R6Clan\r6launch.bat"  "r6clan://create/
; 가 통째로 파일 이름이 되어 "내부 또는 외부 명령이 아닙니다" 가 납니다.
; C:\R6Clan 에는 빈칸이 없으므로 따옴표 없이 적으면 이 문제가 없습니다.
; (r6clan-auto.reg 와 같은 형태입니다)
Root: HKA; Subkey: "Software\Classes\r6clan\shell\open\command"; \
    ValueType: string; ValueName: ""; \
    ValueData: "cmd.exe /c {#ClanDir}\r6launch.bat ""%1"""; Components: clan

#ifdef HAVE_GAME
Root: HKA; Subkey: "Software\Classes\r6clan\DefaultIcon"; \
    ValueType: string; ValueName: ""; ValueData: """{app}\{#GameExeName}"",0"; Components: clan

; ---------- 게임을 항상 관리자 권한으로 실행 ----------
; 이게 없으면 게임이 켜질 때마다 "이 앱이 변경하도록 허용" 창이 뜨거나,
; 설정 파일을 못 써서 옵션이 저장되지 않습니다.
Root: HKA; Subkey: "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"; \
    ValueType: string; ValueName: "{app}\{#GameExeName}"; ValueData: "~ RUNASADMIN"; \
    Flags: uninsdeletevalue; Components: game
#endif


[Run]
; ---------- 윈도우 방화벽 열기 ----------
; 게임은 접속할 때 포트 세 개를 두드립니다. 하나라도 막혀 있으면 그 포트가
; 시간 초과될 때까지 기다렸다 다음으로 넘어가는데, 그 기다림이 곧 "접속이 느림"
; 입니다. r6firewall.bat 과 같은 일을 창 없이 조용히 합니다.
;
; 먼저 예전 규칙을 지웁니다 (여러 번 설치해도 규칙이 쌓이지 않게).
; 규칙이 없어서 실패해도 무시됩니다.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six (r6rank)"""; \
    Flags: runhidden waituntilterminated; Components: clan
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six UDP (r6rank)"""; \
    Flags: runhidden waituntilterminated; Components: clan
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six PING (r6rank)"""; \
    Flags: runhidden waituntilterminated; Components: clan

#ifdef HAVE_GAME
; 게임 프로그램 자체를 통과시킵니다.
Filename: "{sys}\netsh.exe"; \
    Parameters: "advfirewall firewall add rule name=""Rainbow Six (r6rank)"" dir=in action=allow program=""{app}\{#GameExeName}"" enable=yes profile=any"; \
    Flags: runhidden waituntilterminated; StatusMsg: "윈도우 방화벽을 여는 중..."; Components: clan
Filename: "{sys}\netsh.exe"; \
    Parameters: "advfirewall firewall add rule name=""Rainbow Six (r6rank)"" dir=out action=allow program=""{app}\{#GameExeName}"" enable=yes profile=any"; \
    Flags: runhidden waituntilterminated; Components: clan
#endif

; JOIN 2346 · ANNOUNCE 2347 · INFO 2348
Filename: "{sys}\netsh.exe"; \
    Parameters: "advfirewall firewall add rule name=""Rainbow Six UDP (r6rank)"" dir=in action=allow protocol=UDP localport=2346-2348 enable=yes profile=any"; \
    Flags: runhidden waituntilterminated; StatusMsg: "UDP 2346-2348 포트를 여는 중..."; Components: clan
Filename: "{sys}\netsh.exe"; \
    Parameters: "advfirewall firewall add rule name=""Rainbow Six UDP (r6rank)"" dir=out action=allow protocol=UDP localport=2346-2348 enable=yes profile=any"; \
    Flags: runhidden waituntilterminated; Components: clan

; 런쳐가 접속 전에 상대 경로를 미리 데워둘 때 쓰는 ping 응답.
Filename: "{sys}\netsh.exe"; \
    Parameters: "advfirewall firewall add rule name=""Rainbow Six PING (r6rank)"" dir=in action=allow protocol=icmpv4:8,any enable=yes profile=any"; \
    Flags: runhidden waituntilterminated; Components: clan

; 설치가 끝나면 사이트를 열어봅니다 (선택).
Filename: "{#AppURL}"; Description: "r6rank.co.kr 열어보기"; \
    Flags: postinstall shellexec nowait skipifsilent unchecked


[UninstallRun]
; 제거할 때 방화벽 규칙도 같이 걷어냅니다.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six (r6rank)"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "fwGame"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six UDP (r6rank)"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "fwUdp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six PING (r6rank)"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "fwPing"


[UninstallDelete]
; 런쳐가 남긴 기록. 파일 목록에 없으므로 따로 지웁니다.
Type: files;          Name: "{#ClanDir}\r6launch.log"
Type: dirifempty;     Name: "{#ClanDir}"


[Code]

{ ============================================================
  설치가 끝난 뒤, 런쳐 배치 파일 안의 게임 경로를 실제 설치 위치로 고쳐 씁니다.

  r6launch.bat 과 r6firewall.bat 에는 게임 위치가 이렇게 박혀 있습니다:

      set "GAME=C:\Program Files (x86)\...\RainbowSix.exe"

  기본 위치에 설치했다면 그대로 맞지만, 다른 폴더를 고른 사람은 이 줄이
  틀리게 됩니다. 예전에는 "메모장으로 열어서 고치세요" 라고 안내했는데,
  이제 설치 파일이 알아서 맞춰줍니다.
  ============================================================ }
procedure SetGamePathInBat(const BatFile, ExePath: String);
var
  Lines: TArrayOfString;
  i: Integer;
  Changed: Boolean;
begin
  if not FileExists(BatFile) then
    Exit;

  if not LoadStringsFromFile(BatFile, Lines) then
  begin
    Log('런쳐 파일을 읽지 못했습니다: ' + BatFile);
    Exit;
  end;

  Changed := False;
  for i := 0 to GetArrayLength(Lines) - 1 do
    { 줄 맨 앞이 set "GAME= 인 줄만 갈아끼웁니다. 주석이나 안내문에 같은
      글자가 나와도 건드리지 않도록 위치를 1 로 못박아 둡니다. }
    if Pos('set "GAME=', Lines[i]) = 1 then
    begin
      Lines[i] := 'set "GAME=' + ExePath + '"';
      Changed := True;
    end;

  if not Changed then
  begin
    Log('GAME 줄을 찾지 못했습니다: ' + BatFile);
    Exit;
  end;

  { 배치 파일은 일부러 ASCII 로만 되어 있습니다 — cmd.exe 가 배치 파일을
    바이트 위치로 읽기 때문에, 한글이 섞이면 위치가 밀려 엉뚱한 줄을
    글자 중간부터 읽습니다. 경로에 한글 폴더명이 들어가면 같은 문제가
    생기므로, 그런 경우 아래 SaveStringsToFile 이 남기는 파일도 ANSI 입니다. }
  if not SaveStringsToFile(BatFile, Lines, False) then
    Log('런쳐 파일을 저장하지 못했습니다: ' + BatFile);
end;


{ 설치 위치에 한글이나 특수문자가 섞여 있으면 배치 파일이 깨질 수 있습니다.
  막지는 않고, 알려만 줍니다. }
function IsAsciiPath(const Path: String): Boolean;
var
  i: Integer;
  C: Char;
begin
  Result := True;
  for i := 1 to Length(Path) do
  begin
    C := Path[i];
    if Ord(C) > 126 then
    begin
      Result := False;
      Exit;
    end;
  end;
end;


function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID <> wpSelectDir then
    Exit;

  if not IsAsciiPath(WizardDirValue) then
    if MsgBox('설치 위치에 한글이나 특수문자가 들어 있습니다.' + #13#10#13#10
              + WizardDirValue + #13#10#13#10
              + '런쳐가 쓰는 배치 파일은 영문 경로에서만 확실히 동작합니다.' + #13#10
              + '영문·숫자로만 된 경로를 쓰시는 것을 권합니다.' + #13#10#13#10
              + '그래도 이대로 진행할까요?',
              mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
end;


procedure CurStepChanged(CurStep: TSetupStep);
var
  GameExe: String;
begin
  if CurStep <> ssPostInstall then
    Exit;

  if not WizardIsComponentSelected('clan') then
    Exit;

  { 예전에 r6clan-auto.reg 를 직접 실행한 사람은 HKCU 에 같은 등록이 남아
    있습니다. 윈도우는 HKCU 를 HKLM 보다 먼저 보므로, 지우지 않으면 이번에
    등록한 값이 아니라 옛날 값이 계속 쓰입니다. }
  if RegKeyExists(HKEY_CURRENT_USER, 'Software\Classes\r6clan') then
  begin
    Log('예전 HKCU r6clan 등록을 지웁니다.');
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\Classes\r6clan');
  end;

  GameExe := ExpandConstant('{app}\{#GameExeName}');

  SetGamePathInBat(ExpandConstant('{#ClanDir}\r6launch.bat'), GameExe);
  SetGamePathInBat(ExpandConstant('{#ClanDir}\r6firewall.bat'), GameExe);

  if not FileExists(GameExe) then
    MsgBox('클랜 설정은 끝났지만, 고른 폴더에서 게임을 찾지 못했습니다.'
           + #13#10#13#10 + GameExe + #13#10#13#10
           + '게임이 다른 곳에 있다면 이 파일을 메모장으로 열어'
           + #13#10 + '맨 위 GAME 줄의 경로를 고쳐주세요:' + #13#10#13#10
           + ExpandConstant('{#ClanDir}\r6launch.bat'),
           mbInformation, MB_OK);
end;
