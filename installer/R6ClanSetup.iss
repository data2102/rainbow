; ============================================================
;  레인보우 식스 클랜 통합 설치 파일
;  r6rank.co.kr
; ------------------------------------------------------------
;  이 파일은 "설계도"입니다. 게임 파일은 들어있지 않습니다.
;  payload\ 에 재료를 넣고 build.bat 을 실행하면
;  output\R6ClanSetup.exe 가 만들어집니다.
;
;  ※ 반드시 build.bat 으로 빌드하세요.
;    payload\ 에 무엇이 들어있는지 build.bat 이 확인해서
;    HAVE_GAME / HAVE_SKIN / HAVE_EXTRA 를 넘겨줍니다.
;    이 파일만 따로 컴파일하면 클랜 설정만 있는 설치 파일이 나옵니다.
;
;  자세한 방법: installer\README.md
; ------------------------------------------------------------
;  설치 파일이 밟는 순서 (손으로 하던 것과 같은 순서):
;
;    1. r6setup101a.part01.exe 압축 풀기   → 게임 설치
;    2. regsetup.exe 실행                  → 게임 경로를 레지스트리에 등록
;    3. HonestEngine.exe → INSTALL         → 버전 1.04 에서 6.13 으로
;    4. 레나스킨_V2 를 data 폴더에 덮어쓰기
;    5. 클랜 접속 설정 (r6clan:// · 런쳐 · 방화벽)
;
;  순서를 바꾸면 안 됩니다.
;    - 2번이 없으면 3번이 게임을 못 찾습니다
;      (HonestEngine 이 게임 위치를 이 레지스트리에서 읽습니다)
;    - 4번이 3번보다 먼저면 HonestEngine 이 스킨의 sound 를 되돌려 놓습니다
; ============================================================

#define AppName     "레인보우 식스 클랜"
#define AppVersion  "1.0"
#define AppPublisher "r6rank.co.kr"
#define AppURL      "https://r6rank.co.kr"
#define GameExeName "RainbowSix.exe"
#define SfxName     "r6setup101a.part01.exe"

; 런쳐 파일이 반드시 들어가야 하는 자리. r6launch.bat 이 이 경로를 전제로
; 동작하고, r6clan:// 등록도 이 경로를 가리킵니다.
#define ClanDir "C:\R6Clan"

#ifndef HAVE_GAME
  #pragma message "  [알림] 게임 설치 단계 없이 빌드합니다 (payload\game 비어 있음)."
#endif
#ifndef HAVE_SKIN
  #pragma message "  [알림] 스킨 덮어쓰기 단계 없이 빌드합니다 (payload\skin 비어 있음)."
#endif

#if FileExists(AddBackslash(CompilerPath) + "Languages\Korean.isl")
  #define HAVE_KOREAN
#endif


[Setup]
; 이 GUID 는 바꾸지 마세요. 재설치를 같은 프로그램으로 인식하는 표시입니다.
AppId={{8E3C6F1A-4B27-4E9D-9A55-5C1A6D0E7B34}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
VersionInfoDescription={#AppName} 통합 설치
VersionInfoVersion=1.0.0.0

; 원래 게임이 깔리던 자리 그대로.
; 64비트 윈도우에서 {commonpf} 는 "C:\Program Files (x86)" 입니다.
DefaultDirName={commonpf}\Red Storm Entertainment\Tom Clancy's Rainbow Six
DefaultGroupName=Rainbow Six
DisableProgramGroupPage=yes
AllowNoIcons=yes

; regsetup 과 HonestEngine 이 HKLM 에 쓰고, 방화벽도 열어야 합니다.
PrivilegesRequired=admin

; 1998년 게임이므로 32비트 모드로 둡니다 (Program Files (x86)).
; ArchitecturesInstallIn64BitMode 는 일부러 지정하지 않습니다.

OutputDir=output
OutputBaseFilename=R6ClanSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#GameExeName}

; 압축을 푼 게임이 차지하는 자리(약 226MB)는 [Files] 목록에 안 잡히므로
; 따로 알려줘야 "디스크 공간 부족"을 미리 걸러낼 수 있습니다.
ExtraDiskSpaceRequired=260000000

InfoBeforeFile=info-before.txt


[Languages]
#ifdef HAVE_KOREAN
Name: "ko"; MessagesFile: "compiler:Languages\Korean.isl"
#else
Name: "en"; MessagesFile: "compiler:Default.isl"
#endif


[Types]
Name: "full";   Description: "전체 설치 (권장)"
Name: "custom"; Description: "직접 고르기"; Flags: iscustom


[Components]
#ifdef HAVE_GAME
Name: "game";   Description: "게임 본체 설치";                              Types: full custom
Name: "honest"; Description: "HonestEngine 적용 (버전 1.04 에서 6.13 으로)"; Types: full custom
#endif
#ifdef HAVE_SKIN
Name: "skin";   Description: "레나스킨 V2 (data 폴더에 덮어쓰기)";          Types: full custom
#endif
#ifdef HAVE_EXTRA
Name: "extra";  Description: "추가 파일 (그래픽 호환 · 맵 등)";             Types: full custom
#endif
Name: "clan";   Description: "클랜 접속 설정 (사이트 버튼 · 런쳐 · 방화벽)"; Types: full custom


[Tasks]
#ifdef HAVE_GAME
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "추가 작업:"; Components: game
#endif


[Files]
#ifdef HAVE_GAME
; 게임 설치 파일 3권. 이미 RAR 로 압축된 것이라 다시 압축하지 않습니다
; (nocompression) — 시간만 걸리고 크기는 줄지 않습니다.
; {tmp} 에 넣은 것은 설치가 끝나면 윈도우가 알아서 지웁니다.
Source: "payload\game\*"; DestDir: "{tmp}\sfx"; Flags: nocompression; Components: game
#endif

#ifdef HAVE_SKIN
Source: "payload\skin\*"; DestDir: "{tmp}\skin"; \
    Flags: recursesubdirs createallsubdirs; Components: skin
#endif

#ifdef HAVE_EXTRA
Source: "payload\extra\*"; DestDir: "{tmp}\extra"; \
    Flags: recursesubdirs createallsubdirs; Components: extra
#endif

; 런쳐 파일 4종. 이 저장소의 public\ 에 있는 것을 그대로 씁니다.
; 설치가 끝난 뒤 [Code] 가 이 안의 게임 경로를 실제 설치 위치로 고쳐 씁니다.
Source: "..\public\r6launch.bat";     DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan
Source: "..\public\r6firewall.bat";   DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan
Source: "..\public\r6upnp.bat";       DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan
Source: "..\public\r6upnp-close.bat"; DestDir: "{#ClanDir}"; Flags: ignoreversion; Components: clan


[Icons]
Name: "{group}\Rainbow Six";       Filename: "{app}\{#GameExeName}"; WorkingDir: "{app}"
Name: "{group}\{#AppName} 제거";    Filename: "{uninstallexe}"
#ifdef HAVE_GAME
Name: "{autodesktop}\Rainbow Six"; Filename: "{app}\{#GameExeName}"; WorkingDir: "{app}"; Tasks: desktopicon
#endif


[Registry]
; ---------- 사이트의 버튼이 게임을 켤 수 있게 하는 등록 ----------
; HKA = 관리자 권한이면 HKLM. 이 설치 파일은 관리자로 도므로 이 PC 의
; 모든 계정에 적용됩니다.
Root: HKA; Subkey: "Software\Classes\r6clan"; \
    ValueType: string; ValueName: ""; ValueData: "URL:R6 Clan Launcher"; \
    Flags: uninsdeletekey; Components: clan
Root: HKA; Subkey: "Software\Classes\r6clan"; \
    ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Components: clan
Root: HKA; Subkey: "Software\Classes\r6clan\DefaultIcon"; \
    ValueType: string; ValueName: ""; ValueData: """{app}\{#GameExeName}"",0"; Components: clan

; 배치 파일 경로에 따옴표를 씌우지 않습니다.
; cmd 는 /c 뒤가 따옴표로 시작하면 맨 앞과 맨 뒤 따옴표를 떼어냅니다. 그러면
;   C:\R6Clan\r6launch.bat"  "r6clan://create/
; 가 통째로 파일 이름이 되어 "내부 또는 외부 명령이 아닙니다" 가 납니다.
; C:\R6Clan 에는 빈칸이 없으므로 따옴표 없이 적으면 이 문제가 없습니다.
; (r6clan-auto.reg 와 같은 형태입니다)
Root: HKA; Subkey: "Software\Classes\r6clan\shell\open\command"; \
    ValueType: string; ValueName: ""; \
    ValueData: "cmd.exe /c {#ClanDir}\r6launch.bat ""%1"""; Components: clan

; ---------- 게임을 항상 관리자 권한으로 실행 ----------
; 이게 없으면 게임이 설정을 저장하지 못하거나 실행 때마다 걸립니다.
Root: HKA; Subkey: "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"; \
    ValueType: string; ValueName: "{app}\{#GameExeName}"; ValueData: "~ RUNASADMIN"; \
    Flags: uninsdeletevalue


[Run]
Filename: "{#AppURL}"; Description: "r6rank.co.kr 열어보기"; \
    Flags: postinstall shellexec nowait skipifsilent unchecked


[UninstallRun]
; 제거할 때 방화벽 규칙도 걷어냅니다.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six (r6rank)"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "fwGame"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six UDP (r6rank)"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "fwUdp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Rainbow Six PING (r6rank)"""; \
    Flags: runhidden waituntilterminated; RunOnceId: "fwPing"


[UninstallDelete]
Type: files;      Name: "{#ClanDir}\r6launch.log"
Type: dirifempty; Name: "{#ClanDir}"

; 게임은 Inno 가 넣은 것이 아니라 압축 해제로 들어갔으므로 파일 목록에
; 없습니다. 그래서 여기에 적어야 지워집니다.
; R6Clan_Backup 폴더는 일부러 남깁니다 — 덮어쓰기 전 원본이라, 지우면
; 되돌릴 방법이 사라집니다.
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{app}\he"
Type: files;          Name: "{app}\{#GameExeName}"
Type: files;          Name: "{app}\HonestEngine.exe"
Type: files;          Name: "{app}\regsetup.exe"
Type: files;          Name: "{app}\mplaynow.exe"
Type: files;          Name: "{app}\*.dll"
Type: files;          Name: "{app}\*.vxp"
Type: files;          Name: "{app}\*.acm"
Type: files;          Name: "{app}\*.dat"
Type: files;          Name: "{app}\*.txt"
Type: files;          Name: "{app}\*.ini"
Type: files;          Name: "{app}\*.bmp"


[Code]

var
  StepNo: Integer;

{ 진행 상황을 설치 화면에 그대로 보여줍니다.
  단계가 여럿이라 어디서 멈췄는지 안 보이면 답답합니다. }
procedure Say(const Msg: String);
begin
  StepNo := StepNo + 1;
  Log('[' + IntToStr(StepNo) + '] ' + Msg);
  if WizardForm <> nil then
  begin
    WizardForm.StatusLabel.Caption := Msg;
    WizardForm.Refresh;
  end;
end;


{ 프로그램 하나를 돌리고 끝날 때까지 기다립니다.
  못 띄웠으면 -1, 띄웠으면 그 프로그램이 남긴 값을 돌려줍니다. }
function RunWait(const Exe, Params, WorkDir: String; Show: Integer): Integer;
var
  Code: Integer;
begin
  Log('실행: "' + Exe + '" ' + Params + '   (작업폴더: ' + WorkDir + ')');
  if Exec(Exe, Params, WorkDir, Show, ewWaitUntilTerminated, Code) then
    Result := Code
  else
  begin
    Log('  띄우지 못했습니다: ' + SysErrorMessage(DLLGetLastError));
    Result := -1;
  end;
end;


{ 폴더 하나를 다른 폴더 위에 덮어씁니다.
  덮이는 파일은 먼저 BackupDir 로 챙겨둡니다 — 스킨이 마음에 안 들 때
  되돌릴 수 있어야 하고, 덮어쓰기는 되돌릴 수 없기 때문입니다.
  돌려주는 값은 실제로 덮어쓴 파일 수입니다. }
function OverlayDir(const SrcDir, DstDir, BackupDir: String): Integer;
var
  FR: TFindRec;
  S, D, B: String;
begin
  Result := 0;
  if not DirExists(SrcDir) then
    Exit;
  if not ForceDirectories(DstDir) then
  begin
    Log('폴더를 만들지 못했습니다: ' + DstDir);
    Exit;
  end;

  if not FindFirst(AddBackslash(SrcDir) + '*', FR) then
    Exit;
  try
    repeat
      if (FR.Name = '.') or (FR.Name = '..') then
        Continue;
      { payload 폴더에 넣어둔 안내문은 게임 폴더로 따라가지 않게 합니다. }
      if CompareText(FR.Name, '_README.txt') = 0 then
        Continue;

      S := AddBackslash(SrcDir) + FR.Name;
      D := AddBackslash(DstDir) + FR.Name;
      B := AddBackslash(BackupDir) + FR.Name;

      if (FR.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
        Result := Result + OverlayDir(S, D, B)
      else
      begin
        { 원래 있던 파일은 덮기 전에 챙겨둡니다. }
        if FileExists(D) then
        begin
          ForceDirectories(BackupDir);
          FileCopy(D, B, False);
        end;
        if FileCopy(S, D, False) then
          Result := Result + 1
        else
          Log('덮어쓰지 못했습니다: ' + D);
      end;
    until not FindNext(FR);
  finally
    FindClose(FR);
  end;
end;


{ 런쳐 배치 파일 안의 게임 경로를 실제 설치 위치로 고쳐 씁니다.

  r6launch.bat 과 r6firewall.bat 에는 게임 위치가 이렇게 박혀 있습니다:
      set "GAME=C:\Program Files (x86)\...\RainbowSix.exe"
  기본 위치에 설치했다면 그대로 맞지만, 다른 폴더를 고른 사람은 이 줄이
  틀리게 됩니다. 예전에는 "메모장으로 열어 고치세요" 라고 안내했는데,
  이제 설치 파일이 맞춰줍니다. }
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
    { 줄 맨 앞이 set "GAME= 인 줄만 갈아끼웁니다. 주석에 같은 글자가
      나와도 건드리지 않도록 위치를 1 로 못박아 둡니다. }
    if Pos('set "GAME=', Lines[i]) = 1 then
    begin
      Lines[i] := 'set "GAME=' + ExePath + '"';
      Changed := True;
    end;

  if not Changed then
    Log('GAME 줄을 찾지 못했습니다: ' + BatFile)
  else if not SaveStringsToFile(BatFile, Lines, False) then
    Log('런쳐 파일을 저장하지 못했습니다: ' + BatFile);
end;


{ ============================================================
  1단계 — 게임 압축 풀기

  r6setup101a.part01.exe 는 InstallShield 가 아니라 RAR 자동 압축 해제
  파일입니다. 스위치를 주면 조용히 원하는 폴더에 풀립니다.

     -s2        시작 대화상자 감추기
     -y         묻는 것에 모두 예
     -d<경로>   풀 곳

  스위치가 안 먹는 판본일 수도 있으므로, 끝난 뒤 게임 실행 파일이 실제로
  생겼는지 확인합니다. 없으면 사용자가 직접 풀도록 그냥 다시 띄웁니다.
  여기서 조용히 실패하면 뒤 단계가 전부 헛돌고 아무도 이유를 모릅니다.
  ============================================================ }
function ExtractGame(const Target: String): Boolean;
var
  Sfx: String;
begin
  Sfx := ExpandConstant('{tmp}\sfx\{#SfxName}');
  if not FileExists(Sfx) then
  begin
    Log('게임 설치 파일이 없습니다: ' + Sfx);
    Result := False;
    Exit;
  end;

  Say('게임 압축을 푸는 중입니다. 몇 분 걸립니다...');
  RunWait(Sfx, '-s2 -y -d"' + Target + '"', ExtractFilePath(Sfx), SW_SHOW);

  Result := FileExists(AddBackslash(Target) + '{#GameExeName}');
  if Result then
    Exit;

  Log('조용한 압축 해제가 실패했습니다. 직접 풀도록 띄웁니다.');
  MsgBox('게임 압축을 자동으로 풀지 못했습니다.' + #13#10#13#10
         + '창이 하나 열립니다. 압축을 풀 위치를 아래 폴더로 지정하고'
         + #13#10 + '진행해 주세요.' + #13#10#13#10
         + Target + #13#10#13#10
         + '다 끝나면 이 설치가 이어집니다.',
         mbInformation, MB_OK);
  RunWait(Sfx, '', ExtractFilePath(Sfx), SW_SHOW);
  Result := FileExists(AddBackslash(Target) + '{#GameExeName}');
end;


{ ============================================================
  2단계 — regsetup.exe

  게임이 data 폴더를 어디서 찾을지를 레지스트리에 적어두는 프로그램입니다
  (HKLM\SOFTWARE\Red Storm Entertainment\... 아래 ActorPath, BitmapPath 등
  수십 개의 경로).

  이게 없으면 게임이 제 파일을 못 찾습니다. HonestEngine 도 게임 위치를 이
  레지스트리에서 읽으므로 3단계까지 같이 실패합니다.

  현재 폴더를 기준으로 경로를 적으므로 반드시 게임 폴더에서 돌려야 합니다.
  ============================================================ }
procedure RunRegSetup(const GameDir: String);
var
  Exe: String;
begin
  Exe := AddBackslash(GameDir) + 'regsetup.exe';
  if not FileExists(Exe) then
  begin
    Log('regsetup.exe 가 없습니다: ' + Exe);
    Exit;
  end;
  Say('게임 경로를 등록하는 중...');
  RunWait(Exe, '', GameDir, SW_HIDE);
end;


{ ============================================================
  3단계 — HonestEngine

  단추를 눌러야 하는 창입니다. 명령줄로 시키는 방법이 없어서, 창을 띄우고
  무엇을 눌러야 하는지 알려준 다음 닫힐 때까지 기다립니다.

  2단계 뒤에 와야 합니다 (게임 위치를 레지스트리에서 읽습니다).
  ============================================================ }
procedure RunHonestEngine(const GameDir: String);
var
  Exe: String;
begin
  Exe := AddBackslash(GameDir) + 'HonestEngine.exe';
  if not FileExists(Exe) then
  begin
    Log('HonestEngine.exe 가 없습니다: ' + Exe);
    Exit;
  end;

  Say('HonestEngine 적용을 기다리는 중...');
  MsgBox('이제 HonestEngine 창이 열립니다.' + #13#10#13#10
         + '    1.  [ Install ] 단추를 누르세요' + #13#10
         + '    2.  다 되면 [ Exit ] 를 눌러 창을 닫으세요' + #13#10#13#10
         + '이 과정이 게임 버전을 1.04 에서 6.13 으로 올립니다.' + #13#10
         + '하지 않으면 버전이 달라 다른 사람과 같이 못 합니다.' + #13#10#13#10
         + '창을 닫으면 설치가 이어집니다.',
         mbInformation, MB_OK);

  RunWait(Exe, '', GameDir, SW_SHOW);
end;


{ ============================================================
  5단계 — 윈도우 방화벽

  게임은 접속할 때 포트 세 개를 두드립니다. 하나라도 막혀 있으면 그 포트가
  시간 초과될 때까지 기다렸다 다음으로 넘어가는데, 그 기다림이 곧
  "접속이 느림" 입니다. r6firewall.bat 과 같은 일을 창 없이 합니다.

  게임을 다 풀어놓은 뒤에 해야 실행 파일 경로가 실제로 존재합니다.
  ============================================================ }
procedure Fw(const Netsh, Args: String);
begin
  RunWait(Netsh, 'advfirewall firewall ' + Args, '', SW_HIDE);
end;

procedure OpenFirewall(const GameExe: String);
var
  Netsh: String;
begin
  Netsh := ExpandConstant('{sys}\netsh.exe');
  Say('윈도우 방화벽을 여는 중...');

  { 여러 번 설치해도 규칙이 쌓이지 않게 먼저 지웁니다.
    규칙이 없어서 실패해도 상관없습니다. }
  Fw(Netsh, 'delete rule name="Rainbow Six (r6rank)"');
  Fw(Netsh, 'delete rule name="Rainbow Six UDP (r6rank)"');
  Fw(Netsh, 'delete rule name="Rainbow Six PING (r6rank)"');

  if FileExists(GameExe) then
  begin
    Fw(Netsh, 'add rule name="Rainbow Six (r6rank)" dir=in  action=allow program="' + GameExe + '" enable=yes profile=any');
    Fw(Netsh, 'add rule name="Rainbow Six (r6rank)" dir=out action=allow program="' + GameExe + '" enable=yes profile=any');
  end;

  { JOIN 2346 · ANNOUNCE 2347 · INFO 2348 }
  Fw(Netsh, 'add rule name="Rainbow Six UDP (r6rank)" dir=in  action=allow protocol=UDP localport=2346-2348 enable=yes profile=any');
  Fw(Netsh, 'add rule name="Rainbow Six UDP (r6rank)" dir=out action=allow protocol=UDP localport=2346-2348 enable=yes profile=any');

  { 런쳐가 접속 전에 상대까지의 길을 미리 데울 때 쓰는 ping 응답 }
  Fw(Netsh, 'add rule name="Rainbow Six PING (r6rank)" dir=in action=allow protocol=icmpv4:8,any enable=yes profile=any');
end;


{ 설치 위치에 한글이나 특수문자가 섞이면 배치 파일이 깨질 수 있습니다.
  막지는 않고 알려만 줍니다. }
function IsAsciiPath(const Path: String): Boolean;
var
  i: Integer;
begin
  Result := True;
  for i := 1 to Length(Path) do
    if Ord(Path[i]) > 126 then
    begin
      Result := False;
      Exit;
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
              + '런쳐가 쓰는 배치 파일은 영문 경로에서만 확실히 동작합니다.'
              + #13#10 + '영문과 숫자로만 된 경로를 권합니다.' + #13#10#13#10
              + '그래도 이대로 진행할까요?',
              mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
end;


procedure CurStepChanged(CurStep: TSetupStep);
var
  GameDir, GameExe, Backup: String;
  Copied: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;

  StepNo := 0;
  { {app} 는 끝에 역슬래시가 붙지 않습니다. }
  GameDir := ExpandConstant('{app}');
  GameExe := AddBackslash(GameDir) + '{#GameExeName}';

  { 스킨과 추가 파일에 덮이는 원본을 모아둘 곳. 설치할 때마다 새로 만듭니다. }
  Backup := AddBackslash(GameDir) + 'R6Clan_Backup\'
            + GetDateTimeString('yyyymmdd_hhnnss', #0, #0);

  { ---------- 1단계 · 게임 ---------- }
  if WizardIsComponentSelected('game') then
    if not ExtractGame(GameDir) then
    begin
      MsgBox('게임을 설치하지 못했습니다.' + #13#10#13#10
             + GameExe + #13#10#13#10
             + '이 파일이 만들어지지 않았습니다. 뒤 단계는 건너뜁니다.'
             + #13#10 + '디스크 공간이나 백신을 확인한 뒤 다시 설치해 주세요.',
             mbCriticalError, MB_OK);
      Exit;
    end;

  { ---------- 2단계 · 게임 경로 등록 ---------- }
  if WizardIsComponentSelected('game') then
    RunRegSetup(GameDir);

  { ---------- 3단계 · HonestEngine ---------- }
  if WizardIsComponentSelected('honest') then
    RunHonestEngine(GameDir);

  { ---------- 4단계 · 스킨 덮어쓰기 ----------
    HonestEngine 뒤에 와야 합니다. HonestEngine 이 data\sound 를 건드리므로,
    먼저 덮으면 스킨의 소리가 되돌려집니다. }
  if WizardIsComponentSelected('skin') then
  begin
    Say('레나스킨을 덮어쓰는 중...');
    Copied := OverlayDir(ExpandConstant('{tmp}\skin'),
                         AddBackslash(GameDir) + 'data',
                         AddBackslash(Backup) + 'data');
    Log('스킨 파일 ' + IntToStr(Copied) + '개를 덮었습니다.');
  end;

  { ---------- 추가 파일 ---------- }
  if WizardIsComponentSelected('extra') then
  begin
    Say('추가 파일을 넣는 중...');
    Copied := OverlayDir(ExpandConstant('{tmp}\extra'), GameDir, Backup);
    Log('추가 파일 ' + IntToStr(Copied) + '개를 넣었습니다.');
  end;

  { ---------- 5단계 · 클랜 접속 설정 ---------- }
  if WizardIsComponentSelected('clan') then
  begin
    { 예전에 r6clan-auto.reg 를 직접 실행한 사람은 HKCU 에 같은 등록이 남아
      있습니다. 윈도우는 HKCU 를 HKLM 보다 먼저 보므로, 지우지 않으면 이번에
      등록한 값이 아니라 옛날 값이 계속 쓰입니다. }
    if RegKeyExists(HKEY_CURRENT_USER, 'Software\Classes\r6clan') then
    begin
      Log('예전 HKCU r6clan 등록을 지웁니다.');
      RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\Classes\r6clan');
    end;

    Say('런쳐 경로를 맞추는 중...');
    SetGamePathInBat(ExpandConstant('{#ClanDir}\r6launch.bat'), GameExe);
    SetGamePathInBat(ExpandConstant('{#ClanDir}\r6firewall.bat'), GameExe);

    OpenFirewall(GameExe);
  end;

  Say('마무리하는 중...');

  { 덮어쓴 원본을 어디에 두었는지 알려줍니다.
    안 알려주면 되돌릴 방법이 있다는 걸 아무도 모릅니다. }
  if DirExists(Backup) then
    Log('덮어쓰기 전 원본을 여기에 두었습니다: ' + Backup);

  if not FileExists(GameExe) then
    MsgBox('설치는 끝났지만 이 위치에서 게임을 찾지 못했습니다.' + #13#10#13#10
           + GameExe + #13#10#13#10
           + '게임이 다른 곳에 있다면 아래 파일을 메모장으로 열어'
           + #13#10 + '맨 위 GAME 줄의 경로를 고쳐주세요:' + #13#10#13#10
           + ExpandConstant('{#ClanDir}\r6launch.bat'),
           mbInformation, MB_OK);
end;
