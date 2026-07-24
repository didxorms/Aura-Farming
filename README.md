# 떡상농장 · v0.8.0

아직 뜨지 않은 YouTube 영상을 발견해 심고, 실제 조회수 증가를 관찰한 뒤 수확하는 게임 프로토타입입니다. v0.7부터 잔액·밭·발견 순번·수확 기록의 기준은 브라우저가 아니라 서버 DB입니다.

## v0.8에서 완성된 발견 피드

- 다중 구간 분석: 최근 최대 12개 스냅샷으로 시간당 유입·성장률·가속도를 계산
- 초기 발굴 점수: 절대 조회수뿐 아니라 반응률·업로드 신선도·낮은 조회수 구간을 함께 평가
- 신뢰도 판정: 관측 시간과 스냅샷 수가 부족하면 `데이터 축적 중`으로 분리
- 공정한 비교: 전체 백분위와 검색 레인별 백분위를 혼합해 특정 주제 쏠림 완화
- 다양화 추천: 같은 채널은 최대 2개로 제한하고 주제 레인 반복에 감점
- 실제 피드 카드: YouTube 썸네일, 시간당 유입, 시간당 성장률, 판정 신뢰도, 선정 이유 표시
- 추천·급상승·최신·초기 기회 피드와 엔진 상태·마지막 판정 시각 제공

## 현재 구현된 기반

- 익명 플레이어 세션: HttpOnly 쿠키와 Bearer 토큰을 함께 지원
- 서버 권위 게임 규칙: 씨앗 비용, 4개 슬롯, 발견 순번, 수확액, 24시간 자동 수확
- SQLite 영구 저장: 플레이어 잔액·밭 가치, 영상, 조회수 스냅샷, 피드 후보, 관찰 목록, 포지션, 수확, 지갑 원장
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

`players.field_value`는 `balance + 활성 포지션의 현재 예상 수확가 합계`입니다. 심기·수확·실제 조회수 스냅샷이 들어올 때 서버가 다시 계산하며, 이후 랭킹은 이 값을 내림차순으로 조회할 수 있습니다.

## 로컬 실행

Node.js 22.20 이상이 필요합니다.

```powershell
Copy-Item .env.example .env
npm start
```

복사한 `.env`에서 `YOUTUBE_API_KEY` 등 필요한 값을 한 번 설정합니다. 이후 `npm start`, `npm run collect`, `npm run worker`가 `.env`를 자동으로 읽으므로 새 터미널마다 환경변수를 다시 입력할 필요가 없습니다. `.env`가 없어도 명령은 실행되며, 해당 파일은 Git에서 제외됩니다.

브라우저에서 `http://127.0.0.1:4173`을 엽니다.

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
3. 조회수 감사·집계 보정에 따른 감소와 단순 반등을 제거하고 최근·이전 구간의 시간당 성장과 가속도를 계산합니다.
4. 상대 성장률 30%, 절대 유입 20%, 가속도 15%, 반응률 10%, 초기 기회 15%, 신선도 10%를 전체·레인별 백분위로 합산합니다.
5. 관측 신뢰도를 반영한 뒤 돌파·상승·관측·냉각 상태와 선정 이유를 저장합니다.
6. 같은 채널과 레인이 반복되지 않도록 다양화해 추천·급상승·최신·초기 기회 피드를 제공합니다.

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

이 명령은 브라우저 로직, YouTube 어댑터, DB 트랜잭션, 발견 순번 중복 방지, 수확 1회성, 다중 구간 발견 점수와 피드 다양화, 외부 Origin CORS와 Bearer 세션을 검증합니다.

버전별 변경 내용은 [CHANGELOG.md](./CHANGELOG.md)에서 확인할 수 있습니다.
