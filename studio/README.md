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

## 여는 것

| 대상 | 방법 | 결과 |
|---|---|---|
| HTML 파일 하나 | 끌어다 놓기 / 파일 → HTML 열기 | CSS·GSAP → 키프레임 레이어 |
| **프로젝트 폴더** (ES 모듈, Three.js, 폰트, 오디오 …) | 파일 → 폴더 열기 (서버의 폴더 탐색) · 폴더 끌어다 놓기 · 폴더 업로드 | 아래 레이어 타입이 자동으로 생성 |

폴더 프로젝트는 개발 서버가 그대로 제공하므로 상대 경로 모듈/폰트/오디오가 모두 동작합니다. `npm install`을 안 한 폴더도
`three`, `gsap` 같은 흔한 패키지는 스튜디오의 `node_modules`에서 대신 제공합니다. 기본 탐색 위치는 이 저장소의 상위 폴더
(Codespaces에선 `/workspaces`)이고 `MOTION_ROOTS=/경로1:/경로2 npm run dev`로 바꿀 수 있습니다.

### 레이어 타입 — 한 타임라인에서 함께 편집

| 타입 | 무엇 | 편집 |
|---|---|---|
| **Element** | 원본 HTML 요소 (CSS/WAAPI/GSAP에서 가져옴, 또는 클릭해서 지정) | 트랜스폼·불투명도·이펙트 키프레임, 부모-자식 |
| **Script** | 페이지 코드가 그리는 Canvas/WebGL(Three.js 등) | `window.renderAt(t)`가 있으면 임의 시점으로 정확히 이동(없으면 가상 시계). 시작점 = 시간 오프셋, Time Stretch, 트랜스폼·이펙트·블렌드 |
| **Code** | JS 모듈의 `export const` 값 (예: `timeline.js`) | 숫자·문자열·불리언 즉석 수정, 시간 값은 마커, `[시작, 끝]`은 구간 바로 드래그 → **소스 코드의 그 값만** 다시 씀. 계산식 값(예: `KICKS`)은 실행 중인 모듈에서 읽어 회색 마커로 표시 |
| **Audio** | 프로젝트 오디오 파일·추가한 오디오 (여러 개) | 파형, 시작점 드래그, 볼륨, 앞부분 트림, 음소거, 비트 감지 — 미리보기와 렌더에서 믹스 |
| Text / Shape / Solid / Null / Image | 에디터에서 새로 만든 레이어 | 위 모든 레이어 위에 합성 |

**Code 탭**: 파일 트리 + 코드 편집기. 입력 0.6초 뒤 자동 저장, 미리보기 즉시 재로드. 코드 수정도 Ctrl+Z로 되돌릴 수 있고
되돌리면 디스크 파일도 되돌아갑니다. (코드 수정은 폴더의 파일에 바로 기록됩니다 — git으로 관리하는 것을 권장)

**저장/내보내기** (폴더 프로젝트): `Ctrl+S` → 폴더에 `motion.project.json`(레이어·키프레임·이펙트) 저장, 다음에 폴더를 열면 그대로 복원.
`파일 → ZIP 내보내기` → 폴더 전체 + 편집 내용이 들어간 ZIP (정적 서버로 열면 편집한 그대로 재생).
렌더는 Script/Element/새 레이어를 합성하고 모든 Audio 레이어를 믹스합니다.

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
npm run render -- ../my-project-folder                 # 폴더 프로젝트 (motion.project.json 저장 후) → 폴더/out/*.mp4
```

WebGL은 기본적으로 SwiftShader(CPU)로 렌더해 어디서나 같은 결과가 나옵니다. GPU가 있는 PC에서는 `MOTION_GPU=1 npm run dev`
(또는 `MOTION_GPU=1 npm run render …`)로 훨씬 빠르게 렌더할 수 있습니다.

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

- **HTML 파일 하나**로 열면 상대 경로 이미지/폰트를 불러올 수 없습니다 → 폴더째 여세요.
- 코드 레이어는 리터럴 값만 직접 수정합니다. 계산식(`60 / BPM`, `range(...)`)은 Code 탭에서 고칩니다.
- 원본 HTML 요소 레이어의 **쌓임 순서**는 문서 순서를 따릅니다. 새로 만든 레이어만 순서를 바꿀 수 있습니다.
- 스크립트로 매 프레임 DOM 스타일을 직접 바꾸는 애니메이션은 키프레임으로 변환되지 않고 원본대로 재생됩니다.
- 원본 GSAP의 SVG `attr`, MotionPath, SplitText 같은 플러그인 트윈은 아직 변환하지 않습니다.
- 브라우저 이펙트(CSS filter/SVG filter)를 쓰므로 미리보기와 렌더는 Chromium 기준입니다.
