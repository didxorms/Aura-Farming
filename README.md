# 떡상농장 · v0.7.0

아직 뜨지 않은 YouTube 영상을 발견해 심고, 실제 조회수 증가를 관찰한 뒤 수확하는 게임 프로토타입입니다. v0.7부터 잔액·밭·발견 순번·수확 기록의 기준은 브라우저가 아니라 서버 DB입니다.

## v0.7에서 구현된 것

- 익명 플레이어 세션: HttpOnly 쿠키와 Bearer 토큰을 함께 지원
- 서버 권위 게임 규칙: 씨앗 비용, 4개 슬롯, 발견 순번, 수확액, 24시간 자동 수확
- SQLite 영구 저장: 플레이어, 영상, 조회수 스냅샷, 피드 후보, 관찰 목록, 포지션, 수확, 지갑 원장
- 실제 발견 피드: YouTube 검색 → 통계 스냅샷 → 속도·가속도·신선도 점수화
- 외부 서버 대응: API 기본 주소, CORS Origin, 쿠키 정책, DB 경로를 환경변수로 분리
- 실험실 분리: 시간 가속과 모의 성장 곡선은 서버 기록에 영향을 주지 않는 로컬 샌드박스

## 구조

```text
브라우저
  ├─ runtime-config.js      API 서버 주소
  ├─ api-client.js          쿠키/Bearer 세션과 HTTP 요청
  └─ app.js                 화면 상태와 사용자 조작
          │
          ▼
server.js                   세션·피드·심기·수확·관찰 API
          │
          ▼
lib/store.js                저장소 경계
          │
          └─ sqlite-store.js + db/migrations

worker.js                   YouTube 검색·통계 수집·신호 계산·자동 수확
```

브라우저는 예상값을 보여줄 수 있지만 잔액, 발견 순번, 수확 결과는 항상 서버 응답으로 확정합니다. 저장소 호출은 `lib/store.js` 뒤에 모아 두어 이후 PostgreSQL 같은 관리형 DB 어댑터를 추가할 수 있습니다. 현재 번들에 포함된 어댑터는 SQLite입니다.

## 로컬 실행

Node.js 22.20 이상이 필요합니다.

```powershell
$env:YOUTUBE_API_KEY="your-key"
npm start
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. `.env` 파일은 Node가 자동으로 읽지 않으므로 로컬에서는 환경변수로 주입하거나 배포 플랫폼의 환경변수 메뉴를 사용합니다.

발견 후보를 한 번 수집하려면:

```powershell
npm run collect
```

계속 수집하려면 API 서버와 별도 프로세스로 실행합니다.

```powershell
npm run worker
```

`YOUTUBE_API_KEY`가 없으면 직접 입력한 영상의 oEmbed 메타데이터 폴백은 가능하지만 실제 발견 피드 수집과 조회수 스냅샷 갱신은 동작하지 않습니다.

## 외부 서버에 배포

API 서버의 주요 환경변수 예시:

```text
HOST=0.0.0.0
PORT=4173
DATABASE_URL=sqlite:/var/lib/viral-field/viral-field.db
YOUTUBE_API_KEY=...
CORS_ORIGINS=https://app.example.com
PUBLIC_API_BASE_URL=https://api.example.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
```

- 프런트와 API를 같은 서버에서 제공하면 `PUBLIC_API_BASE_URL`은 비워 같은 Origin을 사용해도 됩니다.
- 프런트를 별도 정적 호스트에 두면 배포 시 `runtime-config.js`의 `apiBaseUrl`을 API 주소로 바꿉니다.
- SQLite를 외부 서버에서 사용할 때는 `data` 경로를 반드시 영구 볼륨에 연결합니다.
- 여러 API 인스턴스를 동시에 운영하거나 관리형 DB가 필요해지면 `lib/store.js`에 PostgreSQL 어댑터를 연결하는 것이 다음 단계입니다.
- 완전히 다른 사이트 간 쿠키는 HTTPS에서 `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=None`이 필요합니다. v0.7 클라이언트는 쿠키가 제한될 때 Bearer 세션도 사용합니다.

컨테이너 이미지는 루트의 `Dockerfile`로 만들 수 있습니다. API와 수집 워커는 같은 이미지를 사용하고 실행 명령만 각각 `npm start`, `npm run worker`로 둡니다.

## 발견 피드 수집 방식

기본 설정은 4개 검색 레인을 3시간마다 검색하고, 후보 통계는 15분마다 최대 500개를 요청당 50개씩 묶어 조회합니다.

1. `search.list`로 최근 24시간 후보를 찾습니다.
2. `videos.list`로 조회수·좋아요·댓글 스냅샷을 50개씩 묶어 저장합니다.
3. 상대 조회 속도 40%, 절대 속도 25%, 가속도 20%, 게시 신선도 15%로 신호 점수를 계산합니다.
4. 점수순, 최신순, 저조회수순으로 피드를 제공합니다.

현재 YouTube 할당량은 `search.list`에 별도 일일 100회 제한을 두고, `videos.list` 같은 나머지 조회에는 기본 10,000단위 일일 버킷을 둡니다. 기본 4개 레인 × 하루 8회는 검색 32회이고, 통계는 최대 후보 500개 기준 하루 960회이므로 두 버킷을 각각 넘지 않도록 잡았습니다. 레인 수와 주기는 `YOUTUBE_SEARCH_LANES`, `SEARCH_INTERVAL_MINUTES`, `COLLECTOR_INTERVAL_MINUTES`로 조정합니다.

## 주요 API

- `POST /api/session/anonymous`
- `GET /api/bootstrap`
- `GET /api/feed?sort=signal|new|early`
- `POST /api/videos/resolve`
- `POST /api/positions`
- `POST /api/positions/:id/harvest`
- `POST /api/positions/harvest-all`
- `PUT|DELETE /api/watches/:youtubeId`
- `POST /api/youtube/sync`
- `GET /api/system/status`
- `GET /health/live`
- `GET /health/ready`

## 검증

```powershell
npm run check
```

이 명령은 브라우저 로직, YouTube 어댑터, DB 트랜잭션, 발견 순번 중복 방지, 수확 1회성, 신호 점수, 외부 Origin CORS와 Bearer 세션을 검증합니다.

버전별 변경 내용은 [CHANGELOG.md](./CHANGELOG.md)에서 확인할 수 있습니다.
