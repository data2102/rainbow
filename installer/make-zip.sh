#!/bin/sh
# 클랜에 건네줄 "설치 파일 만들기" 꾸러미를 만든다.
#
#   r6-setup-builder/
#     READ-ME-FIRST.txt      먼저 읽는 안내문
#     BUILD.bat              더블클릭 - installer\build.bat 을 부른다
#     installer/             설계도와 payload 자리
#     public/                런쳐 배치 파일 4종 (build.bat 이 ..\public 을 본다)
#
# 사용법:  sh installer/make-zip.sh [나올파일.zip]
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
OUT=${1:-$ROOT/r6-setup-builder.zip}
WORK=$(mktemp -d)
TOP=$WORK/r6-setup-builder

mkdir -p "$TOP/installer" "$TOP/public"
cp "$HERE/R6ClanSetup.iss" "$HERE/build.bat" "$HERE/info-before.txt" \
   "$HERE/README.md" "$TOP/installer/"
cp -r "$HERE/payload" "$TOP/installer/"
cp "$HERE/READ-ME-FIRST.txt" "$TOP/"
for f in r6launch.bat r6firewall.bat r6upnp.bat r6upnp-close.bat; do
    cp "$ROOT/public/$f" "$TOP/public/"
done

# 맨 위에 두는 시작 단추. installer 안으로 들어가지 않아도 되게 한다.
# ASCII 로만 적는다 - cmd 는 배치 파일을 바이트 위치로 읽는다.
cat > "$TOP/BUILD.bat" <<'BAT'
@echo off
rem Double-click this. It just runs installer\build.bat for you.
cd /d "%~dp0"
if not exist "installer\build.bat" (
    echo   Cannot find installer\build.bat next to this file.
    echo   Unzip the whole folder, keeping it together, then try again.
    pause
    exit /b 1
)
call "installer\build.bat"
BAT

# 윈도우 메모장과 cmd 에서 깨지지 않게 줄바꿈을 CRLF 로 맞춘다.
# BOM 이 있으면 지키고, 이미 CRLF 인 것은 두 번 바뀌지 않게 한다.
find "$TOP" -type f \( -name '*.txt' -o -name '*.bat' -o -name '*.iss' -o -name '*.md' \) \
  -exec python3 -c '
import sys, pathlib
for a in sys.argv[1:]:
    p = pathlib.Path(a); b = p.read_bytes()
    bom, body = (b[:3], b[3:]) if b.startswith(b"\xef\xbb\xbf") else (b"", b)
    p.write_bytes(bom + body.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
' {} +

rm -f "$OUT"
(cd "$WORK" && zip -q -r "$OUT" r6-setup-builder)
rm -rf "$WORK"
echo "만들었습니다: $OUT"
