# Korean (`ko`)

Catalog: `src/i18n/locales/ko.json`. General rules: [TRANSLATORS.md](../TRANSLATORS.md).

## Style

- 해요체를 기본으로 하고, 버튼과 명령은 간결한 동사형으로 쓴다: 「저장」, 「닫기」, 「다시 시도」.
- 영어의 긴 문장은 두 문장으로 나누어도 되지만 의미는 잃지 않는다.
- 한글과 라틴 문자 사이에는 공백을 넣지 않는다. 다만 HUD 코드 앞뒤는 가독성을 위해 띄어 써도 된다.
- 구분 기호 `·`, `—`, `→`, `↗`, `…` 는 그대로 둔다.
- 짧은 라벨, 칩, HUD 판독값은 짧게 유지한다. 줄바꿈보다 표준 약어를 택한다.
- HUD 코드 HDG, BRG, CRS, FOV, DEST, SPD, RANGE, ALT 는 영어 그대로 둔다(항공 계기 관례). 문장 속 단어는 번역한다: heading → 방위, range → 거리.
- 키보드 키는 영어 그대로: Space, Esc, Enter, Tab, Shift, H, 1–9.
- 단위: km, m, km/h, kn(노트), ft, h, min, s. `°` 와 `%` 는 그대로.
- 대문자 영어는 강조로 읽히도록 번역한다: 「LIVE」→「실시간」, 「UNAVAILABLE」→「사용 불가」, 「LOADING」→「불러오는 중」.

## Plurals

한국어에는 복수형 변화가 없고 `Intl.PluralRules('ko')` 는 `other` 만 반환한다. `tn()` 항목은 `other` 하나만 쓴다.

## Glossary

| English | 한국어 |
| --- | --- |
| layer / data layer | 레이어 / 데이터 레이어 |
| feed | 피드 |
| source / data source | 출처 / 데이터 출처 |
| LIVE (status) / live data | 실시간 / 실시간 데이터 |
| SIMULATED | 시뮬레이션 |
| stale / degraded / unavailable | 오래됨 / 저하됨 / 사용 불가 |
| retry / retrying | 재시도 / 재시도 중 |
| key (API key) / POWER UP / POWERED UP | 키 / 파워 업 / 파워 업 완료 |
| Provider Settings | 제공업체 설정 |
| ON / OFF (state chips) | 켜짐 / 꺼짐 |
| enable / disable | 활성화 / 비활성화 |
| globe / map / map source | 지구본 / 지도 / 지도 소스 |
| aircraft, plane / flight / military flights | 항공기 / 항공편 / 군용기 |
| vessel, ship / vessels | 선박 |
| satellite / shell (Starlink) | 위성 / 껍질 |
| launch (rocket) / launch site / space mission | 발사 / 발사장 / 우주 임무 |
| ascent / replay / payload / stage | 상승 / 재생 / 탑재체 / 단 |
| contact / tracking | 콘택트 / 추적 |
| installation / site | 시설 / 장소 |
| mapped / observed | 지도 상의 / 관측됨 |
| camera / CCTV camera | 카메라 / CCTV 카메라 |
| earthquake / active fire | 지진 / 진행 중인 화재 |
| radio station | 방송국 |
| road / flow (traffic) | 도로 / 교통량 |
| scene / shot / scene recipe | 장면 / 샷 / 장면 레시피 |
| briefing / panel / dock | 브리핑 / 패널 / 독 |
| cockpit | 조종석 |
| preset / visual preset | 프리셋 / 시각 프리셋 |
| annotation / whiteboard | 주석 / 화이트보드 |
| detection overlay | 감지 오버레이 |
| terrain / elevation | 지형 / 표고 |
| weather / forecast / radar | 날씨 / 예보 / 레이더 |
| lightning | 낙뢰 |
| cyclone / hurricane / typhoon | 사이클론 / 허리케인 / 태풍 |
| air quality | 대기질 |
| bikeshare / dock (bike) | 공유 자전거 / 거치대 |
| transit / route / stop | 대중교통 / 노선 / 정류장 |
| submarine cable / landing | 해저 케이블 / 상륙점 |
| street level / street view | 스트리트 레벨 / 스트리트 뷰 |
| share link | 공유 링크 |
| Director | 디렉터 모드 |
| voice / microphone | 음성 / 마이크 |
| hold / press / click / select | 누른 채 / 누르기 / 클릭 / 선택 |
| zoom in / zoom out | 확대 / 축소 |
| tilt / north up / reset | 기울이기 / 북쪽 위 / 초기화 |
| save / cancel / close | 저장 / 취소 / 닫기 |
| loading / loaded | 불러오는 중 / 불러옴 |
| error / warning / failed | 오류 / 경고 / 실패 |
| connected / disconnected | 연결됨 / 연결 해제 |
| updated | 업데이트됨 |
