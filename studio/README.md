# Motion Studio

**Claude Code로 만든 HTML 모션그래픽을 After Effects처럼 수정하는 툴.**
만드는 건 Claude가 HTML로 저렴하게, 다듬는 건 사람이 타임라인·키프레임·그래프 에디터로 (수정 단계에서 크레딧 0).

## 실행 (로컬)

```bash
cd studio
npm install
npx playwright install chromium   # 렌더러용, 최초 1회
npm run dev                       # http://localhost:5173
```

## 작동 방식

1. **가져오기** — HTML을 끌어다 놓으면 런타임이 페이지를 가상 시계로 돌리면서 CSS `@keyframes`,
   Web Animations(`element.animate`), GSAP 트윈(타임라인·스태거·repeat/yoyo 포함)을 찾아
   **레이어 + 키프레임**으로 변환합니다. 실제 움직임을 샘플링해 베지에 이징을 피팅하고, 오버슈트처럼
   한 커브로 안 되는 구간은 꼭짓점에서 분할합니다 (원본 대비 오차 < 0.5px, `npm run test:fidelity`).
2. **편집** — 원본 HTML(레이아웃·폰트·그라디언트)은 그대로 두고 움직임만 키프레임 엔진이 구동합니다.
   캔버스/WebGL처럼 스크립트로 그리는 부분은 "Script layer"로 원본 코드가 가상 시계에 맞춰 그대로 돌아갑니다.
3. **저장** — `.motion.html` 한 파일: 브라우저에서 바로 재생되고, 에디터로 다시 열 수 있고, 렌더러 입력이 됩니다.
4. **렌더** — 헤드리스 Chromium이 프레임마다 정확한 시간으로 이동해 무손실 캡처 → ffmpeg 인코딩.

## 기능

| 영역 | 내용 |
|---|---|
| 타임라인 | 레이어 바(이동·트림), 속성 트월, 스톱워치, 키 추가/이동/범위 선택/복사·붙여넣기, 프레임·플레이헤드·키·비트 스냅, 표시/잠금, 이름 변경 |
| 그래프 에디터 | 값 그래프, 키 드래그(시간+값), 베지에 핸들, 이징 프리셋, Hold, `loopOut(cycle/pingpong)` |
| 트랜스폼 | Position X/Y/Z, Scale(균등/XY), Rotation, X/Y Rotation(3D, 원근), Opacity, 블렌드 모드 |
| 부모-자식 | 픽 드롭다운으로 연결, AE처럼 연결 시 현재 모습 유지(보정), DOM 중첩도 자동 반영 |
| 이펙트 | Gaussian Blur, Drop Shadow, Glow, RGB Split, Tint, Brightness & Color — 모든 수치 키프레임 가능 |
| 컴포지션 이펙트 | 위 이펙트 + Vignette, Film Grain을 화면 전체(조정 레이어)에 |
| 애니메이션 프리셋 | Fade In/Out, Pop In, Slide Up/Left, Spin In, Blur In, 3D Flip In, Wiggle |
| 레이어 생성 | Text, Rectangle, Ellipse, Solid, Null, Image(에셋), **원본의 아무 요소나 클릭 → 레이어** |
| 뷰어 | 선택 박스, 이동/스케일/회전 핸들, Alt=부모 요소 / Ctrl=하위 요소 선택, 세이프 가이드, 줌 |
| 오디오 | 파형 트랙, 시작점 드래그, 비트 감지(+BPM), 비트마다 펄스, 키→비트 스냅, 오디오 진폭→키프레임, 렌더에 믹스 |
| 렌더 | H.264 MP4 · VP9 WebM · ProRes 422 HQ MOV · GIF, 0.5×/1×/2× 해상도, 구간, CRF |

## 렌더 (커맨드라인)

```bash
npm run render -- my.motion.html -o out.mp4            # --format webm|mov|gif --fps 60 --scale 2 --start 0 --end 4
```

## 단축키

`Space` 재생 · `←/→`, `PgUp/PgDn` 1프레임 (`Shift` 10프레임) · `Home/End` · `J/K` 이전/다음 키 ·
`F9` Easy Ease (`Shift+F9` In, `Ctrl+Shift+F9` Out) · `Ctrl+Alt+H` Hold · `Shift+F3` 그래프 에디터 ·
`U` 선택 레이어 펼치기 · `Ctrl+Z / Ctrl+Shift+Z` · `Ctrl+C / V` 키 복사·붙여넣기 · `Ctrl+D` 복제 ·
`Ctrl+T` 텍스트 · `Ctrl+] / [` 순서 · `Ctrl+S` 저장 · `Ctrl+O` 열기 · `Ctrl+M` 렌더 · `Ctrl+K` 컴포지션 설정 · `Delete`

## Claude에게 만들게 할 때

[`docs/CLAUDE-AUTHORING.md`](docs/CLAUDE-AUTHORING.md)를 모션그래픽을 만드는 프로젝트의 `CLAUDE.md`에 붙여 두면,
Claude가 이 툴에서 가장 잘 편집되는 형태로 만듭니다 (토큰은 거의 늘지 않습니다).

## 구조

```
src/runtime/motion-runtime.js   페이지 안에서 도는 런타임 (가상 시계 · 분석 · 재생 · 이펙트) — 에디터/내보내기/렌더 공용
src/engine/                     프로젝트 모델, 키프레임, 문서 입출력, 오디오, 편집 액션
src/components/                 UI (Viewer, Timeline, GraphEditor, Inspector, SidePanel, MenuBar, RenderDialog)
render/                         프레임 정확 렌더러 (Playwright + ffmpeg), CLI, Vite 개발 서버 API
test/fidelity.mjs               원본 vs 변환 결과 위치 비교 회귀 테스트
```

## 알려진 한계

- HTML 안의 **상대 경로 이미지/폰트**는 불러올 수 없습니다 (파일 하나만 읽기 때문). data URI나 절대 URL을 쓰세요.
- 원본 HTML 요소 레이어의 **쌓임 순서**는 문서 순서를 따릅니다. 새로 만든 레이어만 순서를 바꿀 수 있습니다.
- 스크립트로 매 프레임 DOM 스타일을 직접 바꾸는 애니메이션은 키프레임으로 변환되지 않고 원본대로 재생됩니다.
- 원본 GSAP의 SVG `attr`, MotionPath, SplitText 같은 플러그인 트윈은 아직 변환하지 않습니다.
- 브라우저 이펙트(CSS filter/SVG filter)를 쓰므로 미리보기와 렌더는 Chromium 기준입니다.
