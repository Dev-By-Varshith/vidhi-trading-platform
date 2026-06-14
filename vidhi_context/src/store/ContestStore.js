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
  customBots: [],           // GM uploaded custom bots: [{id, name, code}]
};

// ─── Store singleton ─────────────────────────────────────────────────────────
class ContestStore {
  constructor() {
    if (ContestStore.instance) return ContestStore.instance;
    ContestStore.instance = this;
    this._listeners = new Set();
    this._load();
    
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
    try {
      const res = await fetch('/api/contests');
      if (res.ok) {
        const data = await res.json();
        // The backend returns an array of Contests. We'll merge them.
        // If the backend has no rounds, ensure it's empty array
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

  // ── Role ──────────────────────────────────────────────────────────────────
  async setRole(role, name = '', team = '') {
    this.state.role = role;
    this.state.studentName = name;
    this.state.studentTeam = team;
    this._save();

    if (role === 'student' && name) {
        try {
            const res = await fetch('/api/contestants', {
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
               const apiKeyRes = await fetch('/api/apikey', {
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
    const contest = {
      id: `contest_${Date.now()}`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      participants: [],
      ...data,
      rounds: (data.rounds || []).map((r, i) => ({
        id: `r${i+1}`,
        status: i === 0 ? 'upcoming' : 'upcoming',
        ...r,
      })),
    };
    this.state.contests.push(contest);
    this._save();

    try {
        const res = await fetch('/api/contests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: contest.name,
                tick_count: contest.rounds[0]?.tickCount || 100000,
                phase: 'public'
            })
        });
        if (res.ok) {
           const d = await res.json();
           contest.id = d.id;
           this._save();

           // Now create rounds on backend
           for (let i = 0; i < contest.rounds.length; i++) {
               const r = contest.rounds[i];
               const rRes = await fetch('/api/rounds', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({
                       contest_id: contest.id,
                       name: r.name,
                       asset_name: 'public_99k',
                       bot_config: (r.activeBots || []).map(b => `${b}:1.0`).join(','),
                       tick_count: r.tickCount || 100000,
                       position_limit: 1000
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
        await fetch('/api/contests', {
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

  // ── Custom Bots (GM) ──────────────────────────────────────────────────────
  addCustomBot(name, code) {
    const id = `BOT_CUSTOM_${Date.now()}`;
    if (!this.state.customBots) this.state.customBots = [];
    this.state.customBots.push({ id, name, code });
    this._save();
  }

  removeCustomBot(id) {
    if (!this.state.customBots) return;
    this.state.customBots = this.state.customBots.filter(b => b.id !== id);
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
    return this.state.contests.find(c => c.id === this.state.activeContestId) || null;
  }
  getActiveRoundId() {
    const c = this.getActiveContest();
    if (!c) return null;
    const activeRound = c.rounds.find(r => r.status === 'active');
    return activeRound ? activeRound.id : null;
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

  reset() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this._save();
  }
}

const store = new ContestStore();
export default store;
