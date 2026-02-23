# SofaScore Data Collector — Handbook

## 1. 项目简介

用 **Playwright** 打开 Chrome 浏览器，导航到 SofaScore 页面，拦截浏览器发出的 API 请求，提取 JSON 数据写入 **Supabase**。

不解析 DOM（除 strengths/weaknesses），只捕获网络请求中的 JSON 响应，稳定且干净。

**目标数据库**: Primary Supabase (`wykjlhbsxparltxazxmk`)

---

## 2. 项目结构

```
sofascore-api/
├── .env.example                    # 环境变量模版
├── .gitignore
├── package.json
├── tsconfig.json
├── handbook.md                     # ← 你正在看的文件
├── skills.md                       # 快速参考指南
│
├── assets/
│   └── teams.json                  # 5 大联赛球队 ID 参考表
│
├── scripts/
│   ├── crawl-5leagues.sh           # 5 大联赛一键 crawl
│   ├── crawl-all.sh                # 6 联赛全量 crawl (含 UCL)
│   ├── crawl-league.sh             # 单联赛 crawl
│   └── crawl-team.sh              # 单球队 crawl
│
├── sql/
│   ├── create-tables.sql           # 4 张 Supabase 表 + 触发器 + 索引
│   └── create-oddsflow-table.sql   # oddsflow_player_statistics 表
│
├── logs/                           # Shell scripts 自动保存的日志
│
└── src/
    ├── crawl-team.ts               # ★ 主脚本: 读 Supabase → crawl SofaScore → 合并写入
    ├── cli.ts                      # CLI 入口 + 流水线编排 (旧流程)
    ├── config/
    │   ├── env.ts                  # 环境变量解析 + 校验
    │   └── leagues.ts              # 6 联赛配置
    ├── browser/
    │   ├── launcher.ts             # Playwright Chrome 启动/关闭
    │   └── interceptor.ts          # 网络请求拦截 + JSON 提取
    ├── collectors/
    │   ├── team-statistics.ts      # 采集器 1: 球队统计
    │   ├── team-players.ts         # 采集器 2: 球队球员名单
    │   ├── player-profile.ts       # 采集器 3: 球员档案
    │   └── player-season-stats.ts  # 采集器 4: 球员赛季统计
    ├── db/
    │   ├── client.ts               # Supabase singleton
    │   └── writer.ts               # 4 个表的 upsert 函数
    └── utils/
        ├── delay.ts                # 延迟控制
        ├── retry.ts                # 重试逻辑
        └── logger.ts               # 日志 (debug/info/warn/error)
```

---

## 3. 新 Mac 安装 (完整步骤)

### 前置条件

Mac 需要先安装好:
- **Node.js** (v18+): `node -v` 检查版本
- **Git**: `git --version` 检查
- **Google Chrome**: Playwright 需要用 Chrome 浏览器

如果没有 Node.js:
```bash
# 用 Homebrew 安装
brew install node

# 或用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 20
```

### 一键安装流程

```bash
# ── Step 1: 克隆仓库 ──
git clone https://github.com/davidyap22/agent-crawling-football-data-tools.git
cd agent-crawling-football-data-tools

# ── Step 2: 安装依赖 ──
npm install

# ── Step 3: 安装 Playwright 浏览器 ──
npx playwright install chromium

# ── Step 4: 配置环境变量 ──
cp .env.example .env

# ── Step 5: 编辑 .env，填入 Supabase anon key ──
# 用你习惯的编辑器打开 .env:
nano .env
# 或
open -a TextEdit .env
# 或
code .env

# ── Step 6: 建表 (首次才需要，如果表已存在可跳过) ──
# 打开 Supabase Dashboard → SQL Editor
# 复制 sql/create-tables.sql 的内容执行
# 复制 sql/create-oddsflow-table.sql 的内容执行

# ── Step 7: 创建 logs 目录 ──
mkdir -p logs

# ── Step 8: 测试 ──
npx ts-node src/crawl-team.ts "Manchester United" --headed --debug
```

### 复制粘贴版 (全部命令)

```bash
git clone https://github.com/davidyap22/agent-crawling-football-data-tools.git
cd agent-crawling-football-data-tools
npm install
npx playwright install chromium
cp .env.example .env
mkdir -p logs
```

然后编辑 `.env` 填入:
```
SUPABASE_ANON_KEY=你的anon key
```

### .env 配置说明

```bash
# ── 必填 ──
SUPABASE_URL=https://wykjlhbsxparltxazxmk.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here    # Supabase → Settings → API → anon public key

# ── 浏览器 (可选) ──
HEADLESS=true              # true=无头模式(后台跑), false=打开浏览器窗口(调试用)
PAGE_DELAY_MS=3000         # 球队页面导航间隔 (毫秒)
TAB_DELAY_MS=2000          # Tab 切换间隔 (毫秒)
PLAYER_DELAY_MS=120000     # 球员之间间隔 (毫秒), 默认 120000 = 2 分钟, 防止被检测

# ── 重试 (可选) ──
MAX_RETRIES=2              # 失败重试次数
RETRY_DELAY_MS=5000        # 重试间隔 (毫秒)

# ── 日志 (可选) ──
LOG_LEVEL=info             # debug | info | warn | error
```

---

## 4. 联赛配置

6 个联赛已预置在 `src/config/leagues.ts`，**球队列表自动从积分榜发现**，不需要手动配置。

| 联赛 | Tournament ID | 球队数 | CLI 名称 |
|------|:---:|:---:|------|
| Premier League | 17 | 20 | `"Premier League"` |
| La Liga | 8 | 20 | `"La Liga"` |
| Bundesliga | 35 | 18 | `"Bundesliga"` |
| Serie A | 23 | 20 | `"Serie A"` |
| Ligue 1 | 34 | 18 | `"Ligue 1"` |
| Champions League | 7 | 36 | `"Champions League"` |

### 自动发现流程

```
1. 导航到 SofaScore 联赛页面
2. 拦截 /standings/seasons API → 获取当前 season ID
3. 拦截 /standings/total API → 获取所有球队 (ID + slug + name)
4. 如果拦截失败，用 page.evaluate(fetch(...)) 直接调 API 作为 fallback
```

Season ID **每个赛季自动更新**，不需要手动改。

---

## 5. 4 个采集器

### 5.1 球队统计 (`sofascore_team_statistics`)

| 字段 | 说明 |
|------|------|
| goals_scored / goals_conceded | 进球 / 失球 |
| shots_total / shots_on_target / shots_off_target | 射门 |
| total_passes / accurate_passes_pct | 传球 |
| possession_pct | 控球率 |
| tackles / interceptions / clearances | 防守 |
| yellow_cards / red_cards / fouls | 纪律 |
| matches_played / wins / draws / losses | 战绩 |
| raw_data (JSONB) | 完整 API 响应 |

**API**: `/api/v1/team/{id}/unique-tournament/{utId}/season/{sId}/statistics/overall`

### 5.2 球队球员 (`sofascore_team_players`)

| 字段 | 说明 |
|------|------|
| player_name / position / shirt_number | 基本信息 |
| height / preferred_foot / country_name | 身体素质 |
| market_value / market_value_currency | 身价 |
| date_of_birth_timestamp / contract_until_timestamp | 出生日期 / 合同 |
| is_injured | 伤病状态 |

**来源**: DOM 链接解析 (`a[href*="/player/"]`)

### 5.3 球员档案 (`sofascore_player_profiles`)

| 字段 | 说明 | 数据来源 |
|------|------|---------|
| player_name, position, height, country | 基本信息 | `__NEXT_DATA__` SSR |
| current_team_id / current_team_name | 当前球队 | SSR |
| market_value / market_value_currency | 身价 | SSR |
| attacking_rating / technical_rating / tactical_rating / defensive_rating / creative_rating | 属性评分 | `/attribute-overviews` API |
| positions (JSONB) | 可踢位置列表 | `/characteristics` API |
| strengths / weaknesses (JSONB) | 优势 / 劣势文字 | DOM 文本解析 |
| national_team_stats (JSONB) | 国家队出场/进球/首秀 | `/national-team-statistics` API |
| transfer_history (JSONB) | 转会记录 | SSR |
| attributes_raw (JSONB) | 完整属性数据 | API |
| raw_profile (JSONB) | 完整 SSR 数据 | SSR |

### 5.4 球员赛季统计 (`sofascore_player_season_stats`)

SofaScore API 返回 **112 个字段**，关键的 65 个作为独立列，全部存入 `raw_data JSONB`。

**Matches**
- appearances, matches_started, minutes_played, totw_appearances

**Attacking**
- goals, expected_goals, scoring_frequency
- total_shots, shots_on_target, shots_off_target
- big_chances_missed, goal_conversion_pct
- free_kick_goals, set_piece_conversion
- goals_from_inside_box, goals_from_outside_box
- headed_goals, left_foot_goals, right_foot_goals
- penalty_goals, penalty_won, hit_woodwork

**Passing**
- assists, expected_assists, touches
- big_chances_created, key_passes
- accurate_passes, accurate_passes_pct, total_passes
- accurate_own_half, accurate_opposition_half
- accurate_long_balls, accurate_long_balls_pct
- accurate_crosses, accurate_crosses_pct
- accurate_chipped_passes

**Defending**
- interceptions, tackles, tackles_won_pct
- possession_won_att_third, ball_recovery
- dribbled_past, clearances, blocked_shots
- error_lead_to_shot, error_lead_to_goal
- penalty_committed

**Other**
- successful_dribbles, successful_dribbles_pct
- total_duels_won, total_duels_won_pct
- ground_duels_won, ground_duels_won_pct
- aerial_duels_won, aerial_duels_won_pct
- possession_lost, fouls, was_fouled, offsides

**Cards**
- yellow_cards, yellow_red_cards, red_cards, direct_red_cards

**Rating**
- rating (SofaScore 赛季平均评分)

**API**: `/api/v1/player/{id}/unique-tournament/{utId}/season/{sId}/statistics/overall`

---

## 6. Terminal 运行方式

### 6.1 Shell Scripts (推荐)

```bash
# ── 5 大联赛全量 crawl ──
bash scripts/crawl-5leagues.sh

# ── 6 联赛全量 (含 Champions League) ──
bash scripts/crawl-all.sh

# ── 单联赛 ──
bash scripts/crawl-league.sh "Premier League"
bash scripts/crawl-league.sh "La Liga"
bash scripts/crawl-league.sh "Bundesliga"
bash scripts/crawl-league.sh "Serie A"
bash scripts/crawl-league.sh "Ligue 1"
bash scripts/crawl-league.sh "Champions League"

# ── 单球队 (测试用) ──
bash scripts/crawl-team.sh 35                              # Man Utd (自动找联赛)
bash scripts/crawl-team.sh 35 "Premier League"             # 指定联赛
bash scripts/crawl-team.sh 2829 "La Liga"                  # Real Madrid
bash scripts/crawl-team.sh 2672 "Bundesliga"               # Bayern Munich
bash scripts/crawl-team.sh 2702 "Serie A"                  # Inter Milan
bash scripts/crawl-team.sh 1644 "Ligue 1"                  # PSG

# ── 加选项 ──
bash scripts/crawl-league.sh "Premier League" --headed     # 打开浏览器窗口
bash scripts/crawl-league.sh "Premier League" --debug      # 详细日志
bash scripts/crawl-league.sh "Premier League" --headed --debug  # 两者都要
```

### 6.2 npm Scripts

```bash
npm run collect:all           # 6 联赛全量
npm run collect:5leagues      # 5 大联赛
npm run collect:epl           # Premier League
npm run collect:laliga        # La Liga
npm run collect:bundesliga    # Bundesliga
npm run collect:seriea        # Serie A
npm run collect:ligue1        # Ligue 1
npm run collect:ucl           # Champions League
```

### 6.3 直接 CLI

```bash
# 完整流水线
npx ts-node src/cli.ts all
npx ts-node src/cli.ts all --league "Premier League"
npx ts-node src/cli.ts all --league "La Liga" --headed --debug
npx ts-node src/cli.ts all --team 35

# 单独采集器
npx ts-node src/cli.ts team-stats --league "Premier League"
npx ts-node src/cli.ts team-players --league "Bundesliga"
npx ts-node src/cli.ts player-profiles --league "Serie A"
npx ts-node src/cli.ts player-stats --league "Ligue 1"
```

### CLI 参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| `all` | 执行全部 4 个采集器 | `src/cli.ts all` |
| `team-stats` | 只采集球队统计 | `src/cli.ts team-stats` |
| `team-players` | 只采集球队球员 | `src/cli.ts team-players` |
| `player-profiles` | 只采集球员档案 | `src/cli.ts player-profiles` |
| `player-stats` | 只采集赛季统计 | `src/cli.ts player-stats` |
| `--league "Name"` | 指定联赛 | `--league "La Liga"` |
| `--team <id>` | 指定球队 ID | `--team 35` |
| `--headed` | 显示浏览器窗口 | 调试时使用 |
| `--debug` | 详细日志输出 | 排错时使用 |

---

## 7. 采集流水线

```
┌──────────────────────────────────────────────────────────────┐
│  启动 Chrome (headless)                                      │
│                                                              │
│  对每个联赛 (1 个或全部 6 个):                                  │
│  │                                                           │
│  ├─ 1. 导航到联赛页面 → 发现当前赛季 + 所有球队                  │
│  │                                                           │
│  ├─ 2. 对每个球队:                                            │
│  │   ├─ Statistics tab → 拦截统计 API → 写入 team_statistics  │
│  │   └─ Players tab → 提取球员列表 → 写入 team_players        │
│  │                                                           │
│  ├─ 3. 对每个球员 (去重):                                     │
│  │   ├─ 球员页面 → SSR + 3 API + DOM → 写入 player_profiles  │
│  │   └─ In-browser fetch → 赛季统计 → 写入 player_season_stats│
│  │                                                           │
│  └─ (PAGE_DELAY_MS 间隔控制)                                  │
│                                                              │
│  关闭浏览器 → 打印汇总报告                                     │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. 数据库表

### 表结构概览

```
sofascore_team_statistics     → UNIQUE(team_id, tournament_id, season_id)
sofascore_team_players        → UNIQUE(player_id, team_id)
sofascore_player_profiles     → UNIQUE(player_id)
sofascore_player_season_stats → UNIQUE(player_id, tournament_id, season_id)
```

### 特性

- 每张表有 `raw_data JSONB` 保存完整 API 响应，不丢失任何字段
- `created_at` / `updated_at` 自动管理时间戳
- 所有写入用 **UPSERT** (冲突时更新)，重跑安全
- 每张表有针对常用查询的索引

### 建表

将 `sql/create-tables.sql` 完整复制到 **Supabase SQL Editor** 执行即可。包含:
- 4 张表定义
- `update_updated_at()` 触发器函数
- 4 个 `BEFORE UPDATE` 触发器
- 7 个索引

---

## 9. 常用球队 ID 速查

### Premier League

| ID | 球队 |
|:--:|------|
| 42 | Arsenal |
| 33 | Chelsea |
| 40 | Liverpool |
| 17 | Manchester City |
| 35 | Manchester United |
| 30 | Tottenham Hotspur |
| 46 | Newcastle United |
| 7 | Aston Villa |
| 48 | West Ham United |
| 45 | Nottingham Forest |

### La Liga

| ID | 球队 |
|:--:|------|
| 2829 | Real Madrid |
| 2817 | FC Barcelona |
| 2836 | Atletico Madrid |
| 2824 | Athletic Bilbao |
| 2828 | Villarreal |
| 2825 | Sevilla |

### Bundesliga

| ID | 球队 |
|:--:|------|
| 2672 | Bayern Munich |
| 2673 | Borussia Dortmund |
| 2681 | Bayer Leverkusen |
| 2671 | RB Leipzig |

### Serie A

| ID | 球队 |
|:--:|------|
| 2697 | Juventus |
| 2702 | Inter Milan |
| 2714 | AC Milan |
| 2700 | Napoli |

### Ligue 1

| ID | 球队 |
|:--:|------|
| 1644 | Paris Saint-Germain |
| 1641 | AS Monaco |
| 1649 | Olympique Marseille |
| 1643 | LOSC Lille |

完整列表见 `assets/teams.json`。

---

## 10. 时间预估

默认 `PLAYER_DELAY_MS=120000` (每个球员间隔 2 分钟，防止平台检测)。

每个球员需要 crawl profile + season stats，各等 2 分钟 = **每球员约 4-5 分钟**。

| 范围 | 球队数 | 球员数 | 预估时间 |
|------|:------:|:------:|:--------:|
| 1 个球队 | 1 | ~25 | ~2 小时 |
| Premier League | 20 | ~500 | ~1.5 天 |
| La Liga | 20 | ~500 | ~1.5 天 |
| Bundesliga | 18 | ~450 | ~1.3 天 |
| Serie A | 20 | ~500 | ~1.5 天 |
| Ligue 1 | 18 | ~450 | ~1.3 天 |
| **5 大联赛** | **96** | **~2400** | **~7 天** |
| 6 联赛 (含 UCL) | 132 | ~3300 | ~10 天 |

> 建议分联赛跑，每天跑 1 个联赛，用 `nohup` 后台执行。

---

## 11. 错误处理 & 重试

- **单个球员/球队失败** → 记录日志 → 继续下一个，不中断
- **重试机制**: 每个操作自动重试 `MAX_RETRIES` 次，间隔 `RETRY_DELAY_MS`
- **幂等写入**: 所有 upsert 基于唯一键，重跑只会更新数据不会重复
- **浏览器崩溃**: catch → 记录 → 退出 (可重新运行从头开始，数据不丢)
- **日志**: Shell scripts 自动保存到 `logs/` 目录

---

## 12. 实用技巧

### 首次运行: 先测试一个球队

```bash
bash scripts/crawl-team.sh 35 "Premier League" --headed --debug
```

看到浏览器打开 → 控制台有日志 → Supabase 4 张表有数据 → 成功。

### 每天跑 1 个联赛 (推荐)

```bash
# 每天跑 1 个联赛，用 nohup 后台执行，不影响 terminal
nohup bash scripts/crawl-league.sh "Premier League" > logs/epl.log 2>&1 &

# 第二天
nohup bash scripts/crawl-league.sh "La Liga" > logs/laliga.log 2>&1 &

# 查看进度
tail -f logs/epl.log
```

### 只更新赛季统计 (最常用)

球员赛季统计变化最频繁，可以单独跑:

```bash
npx ts-node src/cli.ts player-stats --league "Premier League"
```

### 调整球员间隔

默认 2 分钟防检测。如果确认安全可以降低:

```bash
# .env
PLAYER_DELAY_MS=120000    # 2 分钟 (默认，安全)
PLAYER_DELAY_MS=60000     # 1 分钟 (稍快)
PLAYER_DELAY_MS=30000     # 30 秒 (有风险)
```

### 查看 Supabase 数据

```sql
-- 某联赛所有球队统计
SELECT team_name, goals_scored, goals_conceded, wins, draws, losses
FROM sofascore_team_statistics
WHERE tournament_name = 'Premier League'
ORDER BY wins DESC;

-- 某球队所有球员
SELECT player_name, position, shirt_number, market_value
FROM sofascore_team_players
WHERE team_id = 35
ORDER BY shirt_number;

-- 球员赛季数据 (按评分排序)
SELECT player_name, appearances, goals, assists, rating
FROM sofascore_player_season_stats
WHERE tournament_name = 'Premier League'
ORDER BY rating DESC
LIMIT 20;

-- 球员档案 (含属性)
SELECT player_name, attacking_rating, technical_rating, tactical_rating,
       defensive_rating, creative_rating, strengths, weaknesses
FROM sofascore_player_profiles
WHERE current_team_id = 35;
```

---

## 13. 核心技术机制

### 网络拦截 (不是 DOM 解析)

```typescript
// interceptor.ts 核心模式
page.on('response', async (response) => {
  if (response.url().includes(urlPattern) && response.status() === 200) {
    const json = await response.json();
    resolve(json);
  }
});
```

### SSR 数据提取

球员 profile 和 transfer history 来自 Next.js SSR:

```typescript
const nextData = await page.evaluate(() => {
  const el = document.getElementById('__NEXT_DATA__');
  return el ? JSON.parse(el.textContent || '{}') : null;
});
const player = nextData.props.pageProps.initialProps.player;
const transfers = nextData.props.pageProps.initialProps.transfers;
```

### In-browser Fetch (绕过 SPA 缓存)

赛季统计用 `page.evaluate(fetch(...))` 直接调 API，避免 Next.js SPA 缓存问题:

```typescript
const result = await page.evaluate(async (url) => {
  const res = await fetch(url);
  return res.ok ? await res.json() : null;
}, apiUrl);
```

### 资源优化

阻止图片/字体/SVG 下载，加快页面加载:

```typescript
await context.route(/\.(png|jpg|svg|woff|woff2)(\?.*)?$/, (route) => route.abort());
```

---

## 14. 新流程: crawl-team (推荐使用)

### 概念

从 Supabase `player_stats` 表读取球员列表 → crawl SofaScore → 合并写入 `oddsflow_player_statistics`。

```
player_stats (Supabase)          SofaScore (浏览器 crawl)
┌──────────────────────┐        ┌──────────────────────────────┐
│ player_id            │        │ profile (SSR)                │
│ player_name          │        │ attribute_overview (API)      │
│ appearances, goals   │        │ strengths / weaknesses (DOM) │
│ assists, rating...   │        │ national_team (API)          │
│                      │        │ transfer_history (SSR)       │
│                      │        │ season_statistics (API, 112字段) │
└──────────┬───────────┘        └──────────────┬───────────────┘
           │                                   │
           └─────────────┬─────────────────────┘
                         ↓
              oddsflow_player_statistics
              ┌────────────────────────────────┐
              │ player_id                      │
              │ player_name                    │
              │ team_name                      │
              │ supabase_original_data (JSONB) │
              │ sofascore_data (JSONB)         │
              │ data_collection_date           │
              └────────────────────────────────┘
```

### 完整命令列表

#### 单球队

```bash
# 基本用法
npx ts-node src/crawl-team.ts "Manchester United"
npx ts-node src/crawl-team.ts "Arsenal"
npx ts-node src/crawl-team.ts "Liverpool"
npx ts-node src/crawl-team.ts "Chelsea"
npx ts-node src/crawl-team.ts "Manchester City"

# 其他联赛球队 (team_name 必须跟 player_stats 表中的名字一致)
npx ts-node src/crawl-team.ts "Real Madrid"
npx ts-node src/crawl-team.ts "Barcelona"
npx ts-node src/crawl-team.ts "Bayern München"
npx ts-node src/crawl-team.ts "Juventus"
npx ts-node src/crawl-team.ts "Paris Saint Germain"

# 加选项
npx ts-node src/crawl-team.ts "Manchester United" --headed          # 打开浏览器窗口
npx ts-node src/crawl-team.ts "Manchester United" --debug           # 详细日志
npx ts-node src/crawl-team.ts "Manchester United" --headed --debug  # 两者都要
```

#### 单联赛 (自动 crawl 该联赛在 player_stats 中的所有球队)

```bash
npx ts-node src/crawl-team.ts --league "Premier League"
npx ts-node src/crawl-team.ts --league "La Liga"
npx ts-node src/crawl-team.ts --league "Bundesliga"
npx ts-node src/crawl-team.ts --league "Serie A"
npx ts-node src/crawl-team.ts --league "Ligue 1"

# 加选项
npx ts-node src/crawl-team.ts --league "Premier League" --headed --debug
```

#### 5大联赛全量

```bash
npx ts-node src/crawl-team.ts --all
npx ts-node src/crawl-team.ts --all --debug
```

#### npm scripts 快捷方式

```bash
npm run crawl -- "Manchester United"
npm run crawl:league -- "Premier League"
npm run crawl:league -- "La Liga"
npm run crawl:league -- "Bundesliga"
npm run crawl:league -- "Serie A"
npm run crawl:league -- "Ligue 1"
npm run crawl:all
```

#### 后台运行 (推荐用 nohup)

```bash
# 单球队后台跑
nohup npx ts-node src/crawl-team.ts "Manchester United" > logs/mu.log 2>&1 &

# 单联赛后台跑
nohup npx ts-node src/crawl-team.ts --league "Premier League" > logs/epl.log 2>&1 &
nohup npx ts-node src/crawl-team.ts --league "La Liga" > logs/laliga.log 2>&1 &
nohup npx ts-node src/crawl-team.ts --league "Bundesliga" > logs/bundesliga.log 2>&1 &
nohup npx ts-node src/crawl-team.ts --league "Serie A" > logs/seriea.log 2>&1 &
nohup npx ts-node src/crawl-team.ts --league "Ligue 1" > logs/ligue1.log 2>&1 &

# 5大联赛全量后台跑
nohup npx ts-node src/crawl-team.ts --all > logs/all-leagues.log 2>&1 &
```

#### 监控进度

```bash
# 实时查看日志
tail -f logs/epl.log
tail -f logs/all-leagues.log

# 查看后台进程
ps aux | grep crawl-team

# 停止后台进程
kill <PID>
```

### 自动匹配机制

系统不再依赖硬编码的球队 ID，而是:
1. 从 SofaScore 积分榜 API 自动获取当前赛季所有球队 ID
2. 用 5 层策略模糊匹配 `player_stats` 球队名 → SofaScore 球队名:
   - 精确匹配 (大小写不敏感)
   - 规范化匹配 (去口音符号)
   - 包含关系匹配 (如 "Newcastle" ↔ "Newcastle United")
   - 内置别名表 (如 "Bayern München" → "Bayern Munich"、"Paris Saint Germain" → "Paris Saint-Germain")
   - 关键词重叠匹配
3. 未匹配球员通过 SofaScore 球队球员 API (`/api/v1/team/{id}/players`) 做名字匹配

### 流程说明

1. 从 `player_stats` 查询 `team_name = "Manchester United"` → 获得 21 名球员
2. 从 `players_oddsflow_merged` 查找 `player_id → sofascore_id` 映射
3. 没有映射的球员 → 调 SofaScore `/api/v1/team/{id}/players` 获取球队球员列表 → 用名字匹配
4. 对每个球员:
   - 导航到 SofaScore 球员页面
   - 拦截 3 个 API (attributes / characteristics / national-team)
   - 提取 SSR 数据 (profile + transfers)
   - 提取 DOM 数据 (strengths / weaknesses)
   - In-browser fetch 赛季统计 (112 字段)
   - **等待 2 分钟** (`PLAYER_DELAY_MS`)
5. 合并 player_stats 原始数据 + SofaScore 数据
6. Upsert 到 `oddsflow_player_statistics`

### 输出表: `oddsflow_player_statistics`

| 字段 | 类型 | 说明 |
|------|------|------|
| player_id | int4 | api-sports.io 的球员 ID (唯一键) |
| player_name | text | 球员名字 |
| team_name | text | 球队名字 |
| supabase_original_data | jsonb | player_stats 表的完整原始行 |
| sofascore_data | jsonb | SofaScore crawl 的全部数据 |
| data_collection_date | date | 采集日期 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### sofascore_data JSONB 结构

```json
{
  "sofascore_id": 288205,
  "slug": "bruno-fernandes",
  "profile": {
    "name": "Bruno Fernandes",
    "position": "M",
    "height": 179,
    "preferred_foot": "Right",
    "country": "Portugal",
    "date_of_birth": "1994-09-08",
    "shirt_number": 8,
    "team": { "id": 35, "name": "Manchester United" },
    "market_value": 65000000,
    "market_value_currency": "EUR"
  },
  "positions": ["AM", "MC", "MR"],
  "attribute_overview": {
    "attacking": 82,
    "technical": 86,
    "tactical": 75,
    "defending": 42,
    "creativity": 88
  },
  "strengths": ["Consistency", "Key passes", "Long shots"],
  "weaknesses": null,
  "national_team": {
    "team": "Portugal",
    "appearances": 75,
    "goals": 15,
    "debut": "2017-11-10"
  },
  "transfer_history": [...],
  "season_statistics": { /* 112 字段 */ },
  "raw_attributes": { /* 完整 API 响应 */ },
  "raw_characteristics": { /* 完整 API 响应 */ },
  "raw_national_team": { /* 完整 API 响应 */ },
  "raw_season_stats": { /* 完整 API 响应 */ }
}
```

### 建表 SQL

```bash
# 在 Supabase SQL Editor 执行:
sql/create-oddsflow-table.sql
```

### 准备工作

1. 在 Supabase SQL Editor 执行 `sql/create-oddsflow-table.sql`
2. 确保 `.env` 有 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`（或 `SUPABASE_SERVICE_KEY`）
3. 测试单球队: `npx ts-node src/crawl-team.ts "Manchester United" --headed --debug`
4. 确认没问题后，跑联赛: `npx ts-node src/crawl-team.ts --league "Premier League"`

---

## 15. GitHub 仓库

```
https://github.com/davidyap22/agent-crawling-football-data-tools
```

新 Mac 完整安装步骤见 **Section 3**。

快速复制:
```bash
git clone https://github.com/davidyap22/agent-crawling-football-data-tools.git
cd agent-crawling-football-data-tools
npm install
npx playwright install chromium
cp .env.example .env
mkdir -p logs
# 编辑 .env 填入 SUPABASE_ANON_KEY
```
