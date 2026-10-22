# wg-studio

[English](README.md)

브라우저에서 동작하는 WireGuard / wg-quick 설정 편집기  

## Getting Started

Node.js 22.18 이상에서 개발 의존성을 설치한 뒤 실행합니다.

```sh
npm ci
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다. 포트를 바꾸려면 `npm run dev -- --port 8080`를 사용합니다.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

## 기능

- 여러 설정 파일을 독립적인 탭으로 편집
- File 메뉴: 새 설정, 파일 열기, plaintext 가져오기, 저장, 다른 이름으로 저장, 이름 변경
- Interface와 Peer 섹션, 표준 필드 선택 및 사용자 정의 필드, 필드 추가·제거
- Address / DNS / AllowedIPs의 문자열과 리스트 양방향 편집
- 설정 원문과 폼 양방향 동기화, 구문 오류 위치 표시
- 주석, 빈 줄, 알 수 없는 필드, 반복되는 PostUp / PostDown 보존
- 기본 Interface 필드와 Peer 필드 제공
- 개인 키 및 사전 공유 키 생성, 개인 키에 대응하는 공개키 계산
- 입력된 키를 다른 필드처럼 계속 수정 가능
- 실행 취소, 미저장 표시 및 닫기 확인, 밝은/어두운 테마, 반응형 화면
- Ctrl/Cmd+O 파일 열기, Ctrl/Cmd+S 저장, Ctrl/Cmd+Shift+S 다른 이름으로 저장
