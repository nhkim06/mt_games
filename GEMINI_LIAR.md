# [System Role]

당신은 Vue 3, Supabase, Vercel 스택을 다루는 시니어 풀스택 개발자이자 소프트웨어 아키텍트입니다.
제시된 기획과 데이터 테이블을 바탕으로, 버그가 없고 유지보수가 쉬운 효율적인 코드와 아키텍처 설계를 제공해야 합니다.사이트는 모바일을 기본으로 하며, 반응형으로 만들어야 합니다.

---

# [Context: 데이터 테이블 구조]

현재 Supabase에 다음과 같은 테이블이 구축되어 있습니다.

### 1. room

create table public.room (
  id character varying not null,
  game_type character varying not null,
  status character varying not null default 'WAITING'::character varying,
  category character varying null,
  secret_word character varying null,
  current_round integer not null default 1,
  allowed_teams text null,
  name text null,
  constraint room_pkey primary key (id)
) TABLESPACE pg_default;


### 2. team

create table public.team (
  id character varying not null,
  team_name character varying not null,
  score integer not null default 0,
  constraint team_pkey primary key (id)
) TABLESPACE pg_default;

insert into public.team (id, team_name, score, room_id) values
('team_cpu', 'cpu', 0, null),
('team_gpu', 'gpu', 0, null),
('team_ram', 'ram', 0, null),
('team_cache', 'cache', 0, null);


### 3. user
create table public.user (
  id uuid not null,
  name character varying not null,
  room_id character varying null,
  team_id character varying null,
  role character varying null,
  is_voted boolean not null default false,
  is_alive boolean not null default true,
  constraint user_pkey primary key (id),
  constraint user_room_id_fkey foreign KEY (room_id) references room (id) on delete set null,
  constraint user_team_id_fkey foreign KEY (team_id) references team (id) on delete set null
) TABLESPACE pg_default;

### 4. votes
create table public.votes (
  id serial not null,
  room_id character varying null,
  round integer not null,
  voter_id uuid null,
  voter_team_id character varying null,
  target_type character varying not null,
  candidate_id uuid null,
  constraint votes_pkey primary key (id),
  constraint votes_candidate_id_fkey foreign KEY (candidate_id) references "user" (id) on delete CASCADE,
  constraint votes_room_id_fkey foreign KEY (room_id) references room (id) on delete CASCADE,
  constraint votes_voter_id_fkey foreign KEY (voter_id) references "user" (id) on delete CASCADE,
  constraint votes_voter_team_id_fkey foreign KEY (voter_team_id) references team (id) on delete CASCADE
) TABLESPACE pg_default;

### 5. admin
create table public.admin (
  id serial not null,
  user_id uuid not null,
  role_level character varying not null default 'MODERATOR'::character varying,
  constraint admin_pkey primary key (id),
  constraint admin_user_id_key unique (user_id),
  constraint admin_user_id_fkey foreign KEY (user_id) references "user" (id) on delete CASCADE
) TABLESPACE pg_default;

### 6. settings
create table public.settings (
  key text not null,
  value integer not null,
  constraint settings_pkey primary key (key)
) TABLESPACE pg_default;

---

# [User Request]

다음 조건과 페이지 구성에 맞춰 프런트엔드 화면(Vue 3) 설계 및 각 단계별 Supabase 연동 시나리오를 가이드해 주세요. tailwind css 사용.

**포인트 획득 조건**

- 우리팀 라이어 검거 (+10점)
- 우리팀만 상대팀 라이어 검거 (+20점)
  - 두 팀 모두 맞출 시 해당 검거 포인트 없음
- 라이어의 정답 맞추기 (+30점)

시나리오
- 유저
    - 로그인 : 이름 설정, 팀 선택
    - 방 입장, 방 생성 페이지 (전체/라이어/마피아 필터링 가능)
    - 입장 시 대기룸 : 팀별로 팀원명 리스트, 몇명 들어왔는지
    - 게임 시작
        - 본인 카드 조회. 리셋 버튼 있어서 누르면 같은 방 모든 사람 나가지게 (constant 파일)
        - 계정이 [방ID:ㅇㅇㅇㅇ, 상태:게임중, 카테고리:라이어, 역할:라이어]으로 저장되어 있으면 나갔다 와도 역할 화면 조회되게
        
        화면 : 
        <aside>
        
        1. 현재 라운드, 카테고리 - 컴퓨터?
        
        ---
        
        1. 역할
            1. 라이어입니다. + 설명
        
        ---
        
        1. 라이어 지목 (다수결로 채택됩니다)
            1. 본인 팀 라이어 : 선택
            2. 상대팀 라이어 : 선택
            3. [제출]
        </aside>
        
    - 투표 완료
        화면 : 
        <aside>
        
        (본인 팀 내용만 보임)
        - 우리팀 라이어는 ㅇㅇㅇ으로 지목했습니다
            - 라이어가 맞습니다
        - 상대팀 라이어는 ㅇㅇㅇ으로 지목했습니다
            - 라이어가 아닙니다
        </aside>
        
        - 맞췄다면 :
        
        <aside>
        
        - 일반
            - ㅇ팀이 상대 라이어를 맞췄습니다
            - 라이어가 제시어를 맞추는 중입니다…
        - 라이어
            - 화면에 제시어 입력란 - 문자열 trim, 띄어쓰기 상관없게
        </aside>
        
        - 못 맞췄다면 :
            - 두 팀 다 상대팀 라이어를 맞추지 못했습니다!
            - 라운드 수 증가해서 다시 게임 화면으로
- 어드민
    - 유저 / 어드민 화면 선택
    - 통제할 방 선택하는 화면 (라이어, 마피아 통합) :
        - 방 별로 카드 표시.
            - 게임 시작 버튼 / 게임중 상태 표시 / 게임 종료
            - 각 팀당 인원수 표시
            - 진행 상태 표시 : 라이어는 라운드,
        - 방 별 디테일 페이지
            - 제시어, 각 참여자의 역할 볼 수 있음.
        - 팀 별 점수 현황 확인 가능. 포인트 추가 부여, 빼기 가능
        - 플레이어 리스트 : 팀 수정 가능.