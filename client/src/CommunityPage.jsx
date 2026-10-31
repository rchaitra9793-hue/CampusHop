import React, { useEffect, useState } from 'react';
import { api } from './lib/api';
import CampusStats from './CampusStats';

const VIBE = { music: '🎧 Music', chatty: '💬 Chatty', quiet: '🤫 Quiet', study: '📚 Study talk', chai: '☕ Chai stop' };

function NetworkOrbit({ people }) {
  const labels = ['CSE', 'AIML', 'ECE', 'MBA'];
  return (
    <div className="network-orbit" aria-label="Campus network visualization">
      <div className="network-ring network-ring--one" />
      <div className="network-ring network-ring--two" />
      <div className="network-core"><strong>YOU</strong><span>at the centre</span></div>
      {labels.map((x, i) => <span key={x} className={`network-node network-node--${i + 1}`}>{x}</span>)}
      <div className="network-people-stack">
        {people.slice(0, 4).map((p, i) => <span key={p.id} style={{ '--i': i }} title={p.name}>{p.name?.slice(0, 2).toUpperCase()}</span>)}
      </div>
    </div>
  );
}

export default function CommunityPage({ campus }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [post, setPost] = useState('');
  const [posting, setPosting] = useState(false);

  const load = async () => {
    try { setData(await api.community.overview()); setError(''); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const submitPost = async (e) => {
    e.preventDefault();
    if (!post.trim()) return;
    setPosting(true);
    try { await api.community.postWall(post.trim()); setPost(''); await load(); }
    catch (e) { setError(e.message); }
    finally { setPosting(false); }
  };

  const [deleting, setDeleting] = useState(null);

  const deletePost = async (id) => {
    setDeleting(id);
    // Off the wall straight away; the reload confirms what the server kept.
    setData((d) => (d ? { ...d, wall: d.wall.filter((p) => p.id !== id) } : d));
    try { await api.community.deleteWall(id); await load(); }
    catch (e) { setError(e.message); load(); }
    finally { setDeleting(null); }
  };

  if (!data) return <main className="page-shell"><p>{error || 'Building your campus map…'}</p></main>;

  return (
    <main className="page-shell community-page">
      <section className="community-hero">
        <div>
          <span className="eyebrow">THE CAMPUS SIDE QUEST</span>
          <h1>Same campus.<br /><em>Different circles.</em></h1>
          <p>Every shared ride is a tiny networking event with better transport.</p>
        </div>
        <div className="passport-mini">
          <span>✦ CAMPUSHOP PASSPORT</span>
          <strong>{data.profile?.name || 'You'}</strong>
          <small>{data.profile?.course || 'Campus member'} · {data.stats.sharedRides} shared rides</small>
        </div>
      </section>

      <CampusStats stats={campus} />

      <section className="community-grid">
        <article className="community-card community-card--network">
          <div className="card-kicker">01 · CAMPUS NETWORK</div>
          <h2>One route can open a whole new circle.</h2>
          <p>Ride with people outside your course. The best campus connection might begin at a pickup point.</p>
          <NetworkOrbit people={data.network} />
          <div className="connection-strip"><strong>{data.stats.connections}</strong><span>people in your CampusHop circle</span></div>
        </article>

        <article className="community-card">
          <div className="card-kicker">02 · YOUR PASSPORT</div>
          <div className="passport-large">
            <div className="passport-avatar">{(data.profile?.name || 'YO').slice(0,2).toUpperCase()}</div>
            <div><strong>{data.profile?.name || 'You'}</strong><span>{data.profile?.course || 'Campus member'}</span></div>
          </div>
          <div className="passport-stats">
            <div><b>{data.stats.sharedRides}</b><span>shared rides</span></div>
            <div><b>{data.stats.connections}</b><span>connections</span></div>
            <div><b>{data.stats.ridesOffered}</b><span>rides offered</span></div>
          </div>
          <div className="badge-row">{data.badges.map(b => <span className="campus-badge" key={b.key}>{b.icon} <b>{b.name}</b><small>{b.note}</small></span>)}</div>
        </article>
      </section>

      <section className="community-impact">
        <div><span className="eyebrow">YOUR IMPACT</span><h2>You are making the campus a little less car-heavy.</h2></div>
        <div className="impact-number"><strong>{data.stats.estimatedCo2Kg}</strong><span>kg CO₂ estimated avoided*</span></div>
        <small>*Illustrative estimate based on shared-trip distance; not a measured emissions figure.</small>
      </section>

      <section className="smart-section">
        <div className="section-heading-inline"><div><span className="eyebrow">GOOD BETS FOR YOU</span><h2>Rides worth a look.</h2></div><span className="scribble">algorithm, but make it cute ✦</span></div>
        <div className="smart-rides">{data.suggestions.length ? data.suggestions.map(r => <article key={r.id} className="smart-ride"><div className="smart-route"><strong>{r.pickup}</strong><span>→</span><strong>{r.dropoff}</strong></div><div className="smart-meta"><span>{r.time}</span>{r.vibe && <span>{VIBE[r.vibe]}</span>}<span>{r.seats} seats</span></div><small>Suggested from the rides currently moving around campus.</small></article>) : <div className="empty-note">No smart picks yet. Post a route and become somebody else's recommendation. 👀</div>}</div>
      </section>

      <section className="wall-section">
        <div className="section-heading-inline"><div><span className="eyebrow">CAMPUS WALL</span><h2>The campus is talking.</h2></div><span className="scribble">keep it kind, keep it campus ✦</span></div>
        <form className="wall-compose" onSubmit={submitPost}><textarea maxLength="280" value={post} onChange={e => setPost(e.target.value)} placeholder="Ask for a hop. Shout out a co-rider. Share a campus moment…" /><div><small>{post.length}/280</small><button className="primary-button" disabled={posting || !post.trim()}>{posting ? 'Posting…' : 'Pin it to the wall ✦'}</button></div></form>
        {error && <p className="form-error">{error}</p>}
        <div className="wall-grid">{data.wall.map((p, i) => <article className={`wall-note wall-note--${i % 3}`} key={p.id}><span className="pin">●</span>{p.canDelete && <button type="button" className="wall-note-delete" onClick={() => deletePost(p.id)} disabled={deleting === p.id} aria-label="Delete this note" title="Delete this note">{deleting === p.id ? '…' : '×'}</button>}<p>“{p.body}”</p><footer><strong>{p.author?.name || 'Campus member'}</strong><span>{p.author?.course || p.author?.role || 'Campus'}</span></footer></article>)}</div>
      </section>
    </main>
  );
}
