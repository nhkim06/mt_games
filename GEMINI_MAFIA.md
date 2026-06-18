# [System Role]

당신은 Vue 3, Supabase, Vercel 스택을 다루는 시니어 풀스택 개발자이자 소프트웨어 아키텍트입니다.
제시된 기획과 데이터 테이블을 바탕으로, 버그가 없고 유지보수가 쉬운 효율적인 코드와 아키텍처 설계를 제공해야 합니다.사이트는 모바일을 기본으로 하며, 반응형으로 만들어야 합니다.

테이블 구조에 수정이 필요할 시 쿼리문을 알려주세요.

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

- 상대 팀 보스 처치 (+10점)
- 트롤 승 (+20점)

역할 (각 팀에 1명씩. 나머지는 시민.)
- 보스 : 보스가 죽으면 상대팀 승으로 게임은 끝난다. 
- 마피아 : 밤마다 1명씩 처치한다.
- 오른팔 : 1회 보스 대신 죽는다. 
- 트롤 : 트롤이 투표로 죽으면 트롤이 속한 팀이 이긴다


시나리오
- 게임이 시작하면 역할 카드 배분.
    - 이때 역할 카드는 숨기기 view 가능
- 밤이 되었습니다 가 뜨며 배경이 까매짐.
    - 마피아 : 죽일 사람을 선택하시오. 멘트가 있고 참여자 중에 한 명을 선택해서 제출 버튼 누르면 그 사람을 죽일거라 지정할 수 있음
    - 다른 사람들 : 랜덤으로 질문이 나와서 참여자 중 1명을 선택해서 제출할 수 있음.
        - 질문 (constant file) : 아래 중 랜덤 1개
            - 가장 웃긴 사람을 고르시오
            - 가장 이상한 사람을 고르시오 등
        - 마피아도 질문을 볼 수는 있음
- 모든 사람이 제출 완료하면 아침이 되었습니다 하며 배경이 밝아짐.
- 전날 밤에 죽은 사람은 [누구], [누구]입니다. 가 뜸
    - 만약 전날 밤에 보스가 지목되었다면 오른팔이 대신 죽음.
- 아침 화면에는 참여자 리스트가 보이는데, 죽은 사람들은 비활성화, 산 사람은 활성화 되어있음.
    - 처형할 사람을 고르시오가 뜨고 살아있는 참여자 중 1명 선택해서, 제출 누르면 투표 가능.
- 모두가 투표를 제출하면 단상이 뜸. 투표를 가장 많이 받은 참여자가 단상에 보여짐. (동표이면 동표로 밤이 됩니다가 뜸.)
    - 그러면 찬성 / 반대 눌러서 제출 할 수 있고, 찬성이 절반 이상이면 그 사람은 죽게 됨.
    - 투표로 죽은 사람이 트롤이면 게임이 종료되며 트롤 승을 하게 됨.
- 다시 밤으로 넘어감. 보스가 죽을 때까지.