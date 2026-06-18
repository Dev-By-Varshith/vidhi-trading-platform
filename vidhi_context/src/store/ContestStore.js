// src/store/ContestStore.js
// Global singleton contest store — persisted in localStorage
// No Redux, no Context hell. Single source of truth.

const STORAGE_KEY = 'vidhi_contest_store';

const DEFAULT_STATE = {
  role: null,               // 'creator' | 'student' | null (not yet chosen)
  studentId: '',            // From backend API
  studentName: '',
  studentTeam: '',
  studentApiKey: '',        // Generated from backend API
  activeContestId: null,    // which contest the student has joined
  contests: [],             // all contests (fetched from backend)
  mySubmissions: [],        // this student's submission history across all contests
  telemetry: {              // Web Worker / Throttled telemetry stream
    status: 'offline',      // 'offline' | 'connecting' | 'online'
    data: {},               // Throttled payload keyed by run_id
  }
};

// ─── Store singleton ─────────────────────────────────────────────────────────
class ContestStore {
  constructor() {
    if (ContestStore.instance) return ContestStore.instance;
    ContestStore.instance = this;
    this._listeners = new Set();
    this._load();
    this._telemetryDebounceTimer = null;
    this._telemetryBuffer = {};
    
    // Auto-fetch contests on boot
    this.fetchContestsFromServer();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.state = {
          ...DEFAULT_STATE,
          ...parsed,
        };
      } else {
        this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      }
    } catch (_e) {
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); }
    catch (_e) { /* quota exceeded — ignore */ }
    this._listeners.forEach(fn => fn(this.state));
  }

  subscribe(fn) {
    this._listeners.add(fn);
    fn(this.state);
    return () => this._listeners.delete(fn);
  }

  // ── Backend Sync ──────────────────────────────────────────────────────────
  async fetchContestsFromServer() {
    const localUrl = (import.meta.env.VITE_API_URL    || '') + '/api/contests';
    const cloudUrl = (import.meta.env.VITE_CLOUD_API_URL || '') + '/api/contests';

    const tryFetch = async (url) => {
      if (!url || url === '/api/contests') return null;
      const res = await fetch(url).catch(() => null);
      if (!res || !res.ok) return null;
      return res.json().catch(() => null);
    };

    try {
      const [localData, cloudData] = await Promise.all([
        tryFetch(localUrl),
        tryFetch(cloudUrl),
      ]);
      const data = cloudData || localData;
      if (data && Array.isArray(data)) {
        this.state.contests = data.map(c => ({
          ...c,
          participants: c.participants || [],
          rounds: c.rounds || []
        }));
        this._save();
      }
    } catch (e) {
      console.warn('Failed to fetch contests from server:', e);
    }
  }


  // ── Telemetry (WebSocket with Throttling) ──────────────────────────────────
  connectTelemetry(wsConnectFn) {
    if (this.state.telemetry.status === 'online') return;
    
    this.state.telemetry.status = 'connecting';
    this._save();

    this._ws = wsConnectFn(
      // onMessage
      (data) => {
        if (data.type === 'TICK_TELEMETRY' && data.run_id) {
          // Buffer the incoming telemetry data
          this._telemetryBuffer[data.run_id] = data.payload;
          
          // Process buffer every 100ms (10fps UI update) to prevent React freezing
          if (!this._telemetryDebounceTimer) {
            this._telemetryDebounceTimer = setTimeout(() => {
              this.state.telemetry.data = { ...this.state.telemetry.data, ...this._telemetryBuffer };
              this._telemetryBuffer = {};
              this._telemetryDebounceTimer = null;
              this._save();
            }, 100);
          }
        }
      },
      // onConnect
      () => {
        this.state.telemetry.status = 'online';
        this._save();
      },
      // onDisconnect
      () => {
        this.state.telemetry.status = 'offline';
        this._save();
      }
    );
  }

  disconnectTelemetry() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  // ── Role ──────────────────────────────────────────────────────────────────
  async setRole(role, name = '', team = '') {
    this.state.role = role;
    this.state.studentName = name;
    this.state.studentTeam = team;
    this._save();

    if (role === 'student' && name) {
        try {
            const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/contestants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    display_name: name,
                    team_name: team
                })
            });
            if (res.ok) {
               const data = await res.json();
               this.state.studentId = data.user_id;
               
               // Auto-provision API key
               const apiKeyRes = await fetch((import.meta.env.VITE_API_URL || '') + '/api/apikey', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ user_id: data.user_id })
               });
               if (apiKeyRes.ok) {
                  const keyData = await apiKeyRes.json();
                  this.state.studentApiKey = keyData.api_key;
                  localStorage.setItem('vidhi_api_key', keyData.api_key);
               }
               this._save();
            }
        } catch (e) {
            console.warn('Failed to register contestant:', e);
        }
    }
  }

  // ── Contests (Creator) ────────────────────────────────────────────────────
  async createContest(data) {
    let contest;
    const isUpdate = data.id && !data.id.startsWith('contest_'); // existing backend ID
    
    if (isUpdate) {
        const idx = this.state.contests.findIndex(c => c.id === data.id);
        if (idx !== -1) {
            this.state.contests[idx] = { ...this.state.contests[idx], ...data };
            contest = this.state.contests[idx];
        } else {
            contest = { ...data };
            this.state.contests.push(contest);
        }
    } else {
        contest = {
          id: data.id || `contest_${Date.now()}`,
          status: 'draft',
          createdAt: new Date().toISOString(),
          participants: [],
          ...data,
          rounds: (data.rounds || []).map((r, i) => ({
            id: r.id || `r${i+1}`,
            status: i === 0 ? 'upcoming' : 'upcoming',
            ...r,
          })),
        };
        // If it's a new draft with a local ID, replace it if it exists or push new
        const existingIdx = this.state.contests.findIndex(c => c.id === contest.id);
        if (existingIdx !== -1) {
            this.state.contests[existingIdx] = contest;
        } else {
            this.state.contests.push(contest);
        }
    }
    this._save();

    try {
        const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/contests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: isUpdate ? contest.id : undefined,
                name: contest.name,
                tick_count: contest.rounds[0]?.tickCount || 100000,
                phase: 'public'
            })
        });
        if (res.ok) {
           const d = await res.json();
           contest.id = d.id;
           this._save();

           // Now create/update rounds on backend
           for (let i = 0; i < contest.rounds.length; i++) {
               const r = contest.rounds[i];
               const rRes = await fetch((import.meta.env.VITE_API_URL || '') + '/api/rounds', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({
                       id: r.id?.startsWith('round_') ? r.id : undefined,
                       contest_id: contest.id,
                       name: r.name,
                       asset_name: r.asset?.name || 'public_99k',
                       bot_config: (r.activeBots || []).map(b => `${b}:${r.botAggressiveness || 0.5}`).join(','),
                       tick_count: r.tickCount || 100000,
                       tick_rate: r.tickRate || 1,
                       position_limit: r.positionLimit || 1000,
                       starts_at: r.startAt ? new Date(r.startAt).toISOString() : new Date().toISOString(),
                       ends_at: r.endAt ? new Date(r.endAt).toISOString() : new Date(Date.now() + 7*24*60*60*1000).toISOString()
                   })
               });
               if (rRes.ok) {
                   const rData = await rRes.json();
                   contest.rounds[i].id = rData.round_id;
               }
           }
           this._save();
        }
    } catch (e) {
        console.warn('Failed to save contest to backend:', e);
    }

    return contest.id;
  }

  updateContest(id, patch) {
    const idx = this.state.contests.findIndex(c => c.id === id);
    if (idx === -1) return;
    this.state.contests[idx] = { ...this.state.contests[idx], ...patch };
    this._save();
  }

  async publishContest(id) {
    const c = this.getContest(id);
    if (!c) return;
    
    // Set the first round to active so CodeArena knows the contest has started
    const rounds = [...(c.rounds || [])];
    if (rounds.length > 0) {
      rounds[0].status = 'active';
    }
    this.updateContest(id, { status: 'active', rounds });

    try {
        await fetch((import.meta.env.VITE_API_URL || '') + '/api/contests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: c.name,
                tick_count: c.rounds[0]?.tickCount || 100000,
                phase: 'public'
            })
        });
    } catch (e) {
        console.warn('Failed to publish contest to backend:', e);
    }
  }

  endContest(id)     { this.updateContest(id, { status: 'ended' });  }

  deleteContest(id) {
    this.state.contests = this.state.contests.filter(c => c.id !== id);
    this._save();
  }

  // ── Joining (Student) ─────────────────────────────────────────────────────
  joinContest(contestId) {
    const contest = this.state.contests.find(c => c.id === contestId);
    if (!contest) return false;
    
    // Fallback ID if not yet provisioned
    const myId = this.state.studentId || 'me';
    
    // Ensure participants array exists locally
    if (!contest.participants) contest.participants = [];
    
    const alreadyJoined = contest.participants.some(p => p.id === myId);
    if (!alreadyJoined) {
      contest.participants.push({
        id: myId,
        name: this.state.studentName || 'Anonymous',
        team: this.state.studentTeam || 'Solo',
        pnlPct: 0, p99: 0, fills: 0,
        rounds: [],
        joinedAt: new Date().toISOString(),
      });
      this._save();
    }
    this.state.activeContestId = contestId;
    this._save();
    return true;
  }

  leaveContest() {
    this.state.activeContestId = null;
    this._save();
  }

  saveLastCode(code) {
    const contest = this.state.contests.find(c => c.id === this.state.activeContestId);
    if (!contest) return;
    const myId = this.state.studentId || 'me';
    const p = contest.participants.find(p => p.id === myId);
    if (p) {
      p.lastCode = code;
      this._save();
    }
  }

  recordResult(result) {
    const { contestId, roundId, pnlPct, p99, fills, pnlHistory } = result;
    // Update my entry in the contest
    const contest = this.state.contests.find(c => c.id === contestId);
    if (contest) {
      const myId = this.state.studentId || 'me';
      const me = contest.participants.find(p => p.id === myId);
      if (me) {
        me.pnlPct = pnlPct;
        me.p99    = p99;
        me.fills  = fills;
        if (!me.rounds) me.rounds = [];
        const ri = contest.rounds.findIndex(r => r.id === roundId);
        me.rounds[ri] = pnlPct;
      }
    }
    this._save();
  }

  addRunHistory(run) {
    if (!this.state.mySubmissions) this.state.mySubmissions = [];
    this.state.mySubmissions.unshift({ ...run, timestamp: new Date().toISOString() });
    this.state.mySubmissions = this.state.mySubmissions.slice(0, 50);
    this._save();
  }

  // ── Getters ───────────────────────────────────────────────────────────────
  getActiveContest() {
    const explicit = this.state.contests.find(c => c.id === this.state.activeContestId);
    if (explicit) return explicit;

    const liveContest = this.state.contests.find(c =>
      c.status === 'active' && (c.rounds || []).some(r => r.status === 'active')
    );
    if (liveContest) {
      this.state.activeContestId = liveContest.id;
      this._save();
      return liveContest;
    }

    const fallback = this.state.contests[0] || null;
    if (fallback && !this.state.activeContestId) {
      this.state.activeContestId = fallback.id;
      this._save();
    }
    return fallback;
  }
  getActiveRoundId() {
    const c = this.getActiveContest();
    if (!c) return null;
    const activeRound = c.rounds.find(r => r.status === 'active');
    if (activeRound) return activeRound.id;

    const firstRound = c.rounds[0] || null;
    if (firstRound) {
      firstRound.status = firstRound.status || 'active';
      return firstRound.id;
    }
    return null;
  }
  getContest(id) {
    return this.state.contests.find(c => c.id === id) || null;
  }
  getLeaderboard(contestId) {
    const c = this.getContest(contestId);
    if (!c) return [];
    return [...c.participants]
      .sort((a, b) => b.pnlPct - a.pnlPct)
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  async resetAndCreateDemoContests() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));

    // Create Contest 1: IICPC ALGO TRADING SHOWCASE 1
    const contest1 = {
      id: `contest_${Date.now()}_1`,
      name: 'IICPC ALGO TRADING SHOWCASE 1',
      description: 'First showcase contest with Earth Fruit, Mars Banana, and Moon Peanut!',
      status: 'active',
      createdAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      maxParticipants: 100,
      participants: [],
      rounds: [
        {
          id: `r1_${Date.now()}`,
          name: 'Round 1 — Earth Fruit (99.99k ticks)',
          description: 'First round featuring Earth Fruit!',
          status: 'active',
          tickCount: 100000,
          tickRate: 1,
          positionLimit: 1000,
          startingCapital: 100000,
          activeBots: ['MM', 'MOM', 'MR', 'NOISE', 'SNIPER'],
          botAggressiveness: 0.7,
          asset: { name: 'EARTH-FRUIT' },
          testDataName: 'earth_fruit_test.csv',
          testDataKey: 'earth_fruit_test.csv',
          finalDataName: 'earth_fruit_final.csv',
          finalDataKey: 'earth_fruit_final.csv',
          startAt: new Date(Date.now()).toISOString(),
          endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        {
          id: `r2_${Date.now()}`,
          name: 'Round 2 — Mars Banana (99.99k ticks)',
          description: 'Second round featuring Mars Banana!',
          status: 'upcoming',
          tickCount: 100000,
          tickRate: 1,
          positionLimit: 1000,
          startingCapital: 100000,
          activeBots: ['MM', 'MOM', 'MR', 'NOISE', 'SNIPER'],
          botAggressiveness: 0.7,
          asset: { name: 'MARS-BANANA' },
          testDataName: 'mars_banana_test.csv',
          testDataKey: 'mars_banana_test.csv',
          finalDataName: 'mars_banana_final.csv',
          finalDataKey: 'mars_banana_final.csv',
          startAt: new Date(Date.now() + 70 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 130 * 60 * 1000).toISOString(),
        },
        {
          id: `r3_${Date.now()}`,
          name: 'Round 3 — Moon Peanut (99.99k ticks)',
          description: 'Third round featuring Moon Peanut!',
          status: 'upcoming',
          tickCount: 100000,
          tickRate: 1,
          positionLimit: 1000,
          startingCapital: 100000,
          activeBots: ['MM', 'MOM', 'MR', 'NOISE', 'SNIPER'],
          botAggressiveness: 0.8,
          asset: { name: 'MOON-PEANUT' },
          testDataName: 'moon_peanut_test.csv',
          testDataKey: 'moon_peanut_test.csv',
          finalDataName: 'moon_peanut_final.csv',
          finalDataKey: 'moon_peanut_final.csv',
          startAt: new Date(Date.now() + 140 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 200 * 60 * 1000).toISOString(),
        },
      ],
    };

    // Create Contest 2: IICPC ALGO TRADING SHOWCASE 2
    const contest2 = {
      id: `contest_${Date.now()}_2`,
      name: 'IICPC ALGO TRADING SHOWCASE 2',
      description: 'Second showcase contest with Grass Cane and Mango!',
      status: 'active',
      createdAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      maxParticipants: 100,
      participants: [],
      rounds: [
        {
          id: `r1_${Date.now() + 1}`,
          name: 'Round 1 — Grass Cane (99.99k ticks)',
          description: 'First round featuring Grass Cane!',
          status: 'active',
          tickCount: 100000,
          tickRate: 1,
          positionLimit: 1000,
          startingCapital: 100000,
          activeBots: ['MM', 'MOM', 'MR', 'NOISE', 'SNIPER'],
          botAggressiveness: 0.7,
          asset: { name: 'GRASS-CANE' },
          testDataName: 'grass_cane_test.csv',
          testDataKey: 'grass_cane_test.csv',
          finalDataName: 'grass_cane_final.csv',
          finalDataKey: 'grass_cane_final.csv',
          startAt: new Date(Date.now()).toISOString(),
          endAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        {
          id: `r2_${Date.now() + 1}`,
          name: 'Round 2 — Mango (99.99k ticks)',
          description: 'Second round featuring Mango!',
          status: 'upcoming',
          tickCount: 100000,
          tickRate: 1,
          positionLimit: 1000,
          startingCapital: 100000,
          activeBots: ['MM', 'MOM', 'MR', 'NOISE', 'SNIPER'],
          botAggressiveness: 0.8,
          asset: { name: 'MANGO' },
          testDataName: 'mango_test.csv',
          testDataKey: 'mango_test.csv',
          finalDataName: 'mango_final.csv',
          finalDataKey: 'mango_final.csv',
          startAt: new Date(Date.now() + 70 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 130 * 60 * 1000).toISOString(),
        },
      ],
    };

    this.state.contests = [contest1, contest2];
    this.state.activeContestId = contest1.id; // Auto-select first demo contest
    this._save();
  }

  reset() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this._save();
  }
}

const store = new ContestStore();
export default store;
