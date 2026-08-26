"""
원본 한 장짜리 HTML(r6_ladder.html)의 CSS·마크업에 서버 연동 스크립트(app.js)를 결합해
public/index.html 을 생성합니다.

  python3 scripts/build_index.py [원본HTML경로]

원본 경로를 생략하면 scripts/r6_ladder.html 을 찾습니다.
디자인을 수정할 때는 원본 HTML을, 동작을 수정할 때는 scripts/app.js 를 고친 뒤
이 스크립트를 다시 실행하세요.
"""
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

orig_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'scripts' / 'r6_ladder.html'
if not orig_path.exists():
    sys.exit(
        f'원본 HTML을 찾을 수 없습니다: {orig_path}\n'
        '사용법: python3 scripts/build_index.py <원본 r6_ladder.html 경로>'
    )

orig = orig_path.read_text(encoding='utf-8')
app = (ROOT / 'scripts' / 'app.js').read_text(encoding='utf-8')

# CSS + 마크업만 사용한다. 구버전 원본 HTML을 그대로 넘긴 경우 인라인 스크립트가
# 딸려오므로 첫 스크립트 태그 앞에서 잘라낸다.
marker = '<' + 'script>'
head = orig[:orig.index(marker)] if marker in orig else orig

# select 스타일 보강 + 연결 실패 배너 스타일
head = head.replace(
    "  .modal-box input:focus{outline:none;border-color:var(--amber-dim);}",
    """  .modal-box input:focus,.modal-box select:focus{outline:none;border-color:var(--amber-dim);}
  .modal-box select{
    width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);
    font-family:'Share Tech Mono',monospace;padding:10px;font-size:14.5px;font-weight:600;
  }
  #connBanner{
    display:none;border:1px solid var(--danger);background:rgba(255,92,73,0.1);
    color:var(--danger);padding:12px 14px;margin-bottom:14px;font-size:13.5px;font-weight:700;
  }"""
)

# 서버 연결 실패 배너 삽입
head = head.replace('  <nav class="tabs">', '  <div id="connBanner"></div>\n\n  <nav class="tabs">')

# 초기 비밀번호 안내 문구 수정
head = head.replace(
    '<button class="btn" id="addAdminBtn">어드민 추가 (초기 비밀번호 1234)</button>',
    '<button class="btn" id="addAdminBtn">어드민 추가 (임시 비밀번호 자동 발급)</button>'
)
head = head.replace(
    '<div class="foot-note">이 랭킹 데이터는 이 페이지를 이용하는 모든 사용자에게 공유됩니다. '
    '다른 계정/사이트로 옮길 때는 내보내기로 백업한 JSON을 새 사본에서 가져오기 하세요.</div>',
    '<div class="foot-note">모든 데이터는 서버 DB에 저장됩니다. 정기적으로 내보내기(JSON)로 '
    '백업해두세요. 내보내기 파일에는 비밀번호가 포함되지 않습니다.</div>'
)

out = head + '<script>\n' + app + '\n</script>\n</body>\n</html>\n'
target = ROOT / 'public' / 'index.html'
target.write_text(out, encoding='utf-8')
print(f'index.html 생성: {target} ({len(out)} bytes)')
