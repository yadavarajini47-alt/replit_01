import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowRight, BadgeCheck, BarChart3,
  Check, ChevronRight, CircleHelp, Clock3, CloudUpload, FileImage, Filter,
  FlaskConical, Leaf, Menu, Search, ShieldCheck, Sprout, Trash2, Upload,
  Wheat, X, Zap,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey, getGetDetectionQueryKey, getGetModelStatusQueryKey,
  getHealthCheckQueryKey, getListDetectionsQueryKey, useCreateDetection, useDeleteDetection,
  useGetDashboardSummary, useGetDetection, useGetModelStatus, useHealthCheck, useListDetections,
} from '@workspace/api-client-react';
import type { Detection } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const client = new QueryClient();
const nav = [
  { href: '/', label: 'Home', icon: Sprout },
  { href: '/detection', label: 'New detection', icon: Upload },
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/history', label: 'Detection history', icon: Clock3 },
  { href: '/about', label: 'About the model', icon: CircleHelp },
];

function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = (href: string) => href === '/' ? path === '/' : path.startsWith(href);
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand" onClick={() => setMenuOpen(false)}>
        <span className="brand-mark"><Leaf size={21} strokeWidth={2.3}/></span>
        <span className="brand-name">Smart Crop<span>Disease Detection</span></span>
      </Link>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav">{nav.map(({ href, label, icon: Icon }) =>
        <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`nav-link ${active(href) ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
          <Icon size={18}/><span>{label}</span>{active(href) && <ChevronRight size={15} className="nav-chevron"/>}
        </Link>)}
      </nav>
      <div className="sidebar-spacer"/>
      <div className="sidebar-note"><span className="note-icon"><ShieldCheck size={17}/></span>
        <div><b>Results with context</b><p>Every prediction is a guide, not a guarantee.</p></div>
      </div>
      <div className="side-foot"><span className="live-dot"/><span>Smart Crop workspace</span><span className="version">v1.0</span></div>
    </aside>
    {menuOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu icon-btn" aria-label="Open navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20}/></button>
        <div className="crumb">SMART CROP <span>/</span> <b>{nav.find(item => active(item.href))?.label ?? 'Workspace'}</b></div>
        <div className="topbar-right"><span className="top-status"><span className="live-dot"/>Crop health workspace</span><Link href="/detection" className="top-action"><Upload size={15}/> New detection</Link></div>
      </header>
      <main className="main-content">{children}</main>
      <footer className="app-footer"><span>Smart Crop <span className="footer-dot">·</span> Crop health, in focus</span><Link href="/about">How the model works <ArrowRight size={13}/></Link></footer>
    </div>
  </div>;
}

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{action && <div className="intro-action">{action}</div>}</div>;
}

function LoadingPanel({ label = 'Loading your field data' }: { label?: string }) {
  return <div className="loading-panel"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-line"/><div className="skeleton skeleton-line short"/><span className="loading-copy">{label}…</span></div>;
}
function ErrorPanel({ retry, label = 'We couldn’t load this right now.' }: { retry: () => void; label?: string }) {
  return <div className="error-panel"><div className="error-icon"><Activity size={19}/></div><div><b>{label}</b><p>Your saved information is still safe. Try again in a moment.</p></div><button className="button button-soft" onClick={retry}>Try again</button></div>;
}
function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><Leaf size={23}/></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function ModelPill({ ready, message }: { ready?: boolean; message?: string }) {
  return <span className={`model-pill ${ready ? 'is-ready' : 'is-down'}`} title={message}>
    <span className="status-dot"/>{ready ? 'Model ready' : 'Model unavailable'}
  </span>;
}
function DateText({ date }: { date: string }) {
  const value = new Date(date);
  return <>{Number.isNaN(value.getTime()) ? date : value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>;
}
function StatusBadge({ detection }: { detection: Detection }) {
  return detection.status === 'diagnosed'
    ? <span className="result-badge diagnosed"><BadgeCheck size={13}/> Assessed</span>
    : <span className="result-badge unavailable"><FlaskConical size={13}/> No model result</span>;
}

function DetectionRow({ item, onDelete }: { item: Detection; onDelete?: (item: Detection) => void }) {
  return <div className="detection-row" data-testid={`row-detection-${item.id}`}>
    <Link href={`/results/${item.id}`} className="row-image-link">
      {item.imageUrl ? <img src={item.imageUrl} alt={`${item.cropType} leaf`} className="row-image"/> : <span className="row-image-placeholder"><Leaf size={21}/></span>}
    </Link>
    <div className="row-main"><Link href={`/results/${item.id}`} className="row-title">{item.disease || (item.status === 'model_unavailable' ? 'Assessment unavailable' : 'Detection details')}</Link>
      <div className="row-meta">{item.cropType}{item.farmName ? ` · ${item.farmName}` : ''}<span className="meta-sep">·</span><DateText date={item.createdAt}/></div>
    </div>
    <div className="row-status"><StatusBadge detection={item}/></div>
    <Link href={`/results/${item.id}`} className="row-open" aria-label={`Open ${item.originalFilename}`}><ArrowRight size={17}/></Link>
    {onDelete && <button className="icon-btn delete-row" aria-label={`Delete ${item.originalFilename}`} onClick={() => onDelete(item)} data-testid={`button-delete-${item.id}`}><Trash2 size={16}/></button>}
  </div>;
}

function Overview() {
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: 1 } });
  const model = useGetModelStatus({ query: { queryKey: getGetModelStatusQueryKey(), retry: 1 } });
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), retry: 1 } });
  const recent = summary.data?.recentDetections ?? [];
  return <div className="page-wrap">
    <section className="welcome-banner">
      <div className="welcome-copy">
        <div className="eyebrow eyebrow-light"><span className="eyebrow-rule"/> SMART CROP DISEASE DETECTION PLATFORM</div>
        <h1>Smart Crop Disease<br/><em>Detection Platform</em></h1>
        <p>Take a clear leaf photo, save what you see, and get honest guidance about the model’s response.</p>
        <div className="welcome-actions"><Link href="/detection" className="button button-white">Detect Disease <ArrowRight size={16}/></Link><Link href="/history" className="welcome-text-link">View saved observations <ArrowRight size={14}/></Link></div>
      </div>
      <div className="banner-art" aria-hidden="true">
        <div className="field-illustration">
          <div className="sun-mark"/>
          <div className="hill hill-back"/>
          <div className="hill hill-front"/>
          <div className="crop-stalk stalk-one"><Wheat size={86} strokeWidth={1.15}/></div>
          <div className="crop-stalk stalk-two"><Sprout size={103} strokeWidth={1.15}/></div>
          <div className="crop-stalk stalk-three"><Leaf size={65} strokeWidth={1.15}/></div>
          <span className="illustration-caption">A clearer view of your crops</span>
        </div>
      </div>
    </section>

    <section className="home-section home-intro-section">
      <div className="section-heading"><div><div className="eyebrow">A PRACTICAL FIELD TOOL</div><h2>Useful guidance, without the guesswork.</h2></div></div>
      <p className="home-intro-copy">Smart Crop Disease Detection Platform helps you keep a photo-based record of crop leaves. When a model assessment is available, it is shown with context. If not, your observation is still saved and you are told clearly.</p>
    </section>
    <section className="home-section home-info-grid" aria-label="Platform information">
      <article className="home-info-panel">
        <div className="info-index">01 / FEATURES</div><h2>Keep the important details together.</h2>
        <p>Add a leaf photo, crop type, field name, and notes to one saved observation. Return to your field log whenever you need it.</p>
        <Link href="/detection" className="inline-link">Explore detection <ArrowRight size={15}/></Link>
      </article>
      <article className="home-info-panel how-panel">
        <div className="info-index">02 / HOW IT WORKS</div><h2>Three simple steps.</h2>
        <ol className="home-steps"><li><span>1</span>Choose a clear leaf photo.</li><li><span>2</span>Add the crop and any field notes.</li><li><span>3</span>Review what the model actually returned.</li></ol>
      </article>
      <article className="home-info-panel benefit-panel">
        <div className="info-index">03 / BENEFITS</div><h2>A record you can come back to.</h2>
        <p>Save observations over time and keep your notes in one place. Model results are not a confirmed diagnosis, and unavailable results are never presented as one.</p>
        <Link href="/about" className="inline-link">Read about limitations <ArrowRight size={15}/></Link>
      </article>
    </section>

    <div className="connection-row">
      <div className={`connection-indicator ${health.data ? 'connected' : health.isError ? 'disconnected' : ''}`}><span className="live-dot"/>{health.isLoading ? 'Connecting to service' : health.data ? 'Service connected' : health.isError ? 'Service connection issue' : 'Service status pending'}</div>
      {model.data && <ModelPill ready={model.data.ready} message={model.data.message}/>}
      {model.isError && <ModelPill ready={false} message="Model status could not be reached."/>}
      <Link href="/about" className="connection-link">About model readiness <ArrowRight size={13}/></Link>
    </div>

    <section className="home-section">
      <div className="section-heading"><div><div className="eyebrow">YOUR FIELD LOG</div><h2>A little more context, every time.</h2></div><Link className="inline-link" href="/dashboard">See activity <ArrowRight size={15}/></Link></div>
      <div className="home-metrics">
        <div className="home-metric metric-feature"><div className="metric-topline"><span>Saved observations</span><span className="metric-icon"><FileImage size={17}/></span></div>
          {summary.isLoading ? <div className="skeleton metric-skeleton"/> : summary.data ? <><div className="metric-number">{summary.data.totalDetections}</div><div className="metric-foot">All detections in your field log</div></> : <div className="metric-fallback">Activity summary unavailable</div>}
        </div>
        <div className="home-metric"><div className="metric-topline"><span>Assessed by model</span><span className="metric-icon pale"><Check size={16}/></span></div>
          {summary.isLoading ? <div className="skeleton metric-skeleton"/> : <><div className="metric-number">{summary.data?.diagnosedCount ?? '—'}</div><div className="metric-foot">A model response was recorded</div></>}
        </div>
        <div className="home-metric"><div className="metric-topline"><span>Model unavailable</span><span className="metric-icon amber"><FlaskConical size={16}/></span></div>
          {summary.isLoading ? <div className="skeleton metric-skeleton"/> : <><div className="metric-number">{summary.data?.modelUnavailableCount ?? '—'}</div><div className="metric-foot">Saved honestly, without a diagnosis</div></>}
        </div>
      </div>
    </section>

    <section className="home-section recent-section">
      <div className="section-heading"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>From the field log</h2></div><Link className="inline-link" href="/history">All detections <ArrowRight size={15}/></Link></div>
      {summary.isLoading ? <LoadingPanel label="Gathering recent detections"/> : summary.isError ? <ErrorPanel retry={() => summary.refetch()}/> :
        recent.length ? <div className="list-card">{recent.slice(0, 4).map(item => <DetectionRow item={item} key={item.id}/>)}</div> :
        <EmptyState title="Your field log starts here" text="Upload a clear leaf photo to create your first saved observation." action={<Link href="/detection" className="button button-primary">Make a detection <ArrowRight size={15}/></Link>}/>}
    </section>
    <section className="trust-strip"><ShieldCheck size={19}/><span><b>Honest by design.</b> If the disease model is unavailable, we’ll tell you plainly — no guessed results.</span><Link href="/about">Read about limitations <ArrowRight size={13}/></Link></section>
  </div>;
}

function DetectionPage() {
  const model = useGetModelStatus({ query: { queryKey: getGetModelStatusQueryKey(), retry: 1 } });
  const create = useCreateDetection();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropType, setCropType] = useState('');
  const [farmName, setFarmName] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const supported = model.data?.supportedCrops ?? [];

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function chooseFile(next?: File) {
    if (!next) return;
    const extension = next.name.split('.').pop()?.toLowerCase();
    const expectedType = extension === 'png' ? 'image/png' : 'image/jpeg';
    if (!['jpg', 'jpeg', 'png'].includes(extension ?? '') || (next.type && next.type !== expectedType)) {
      setFormError('This file is not a JPG, JPEG, or PNG image. Please choose a photo in one of those formats.');
      setFile(null);
      setPreview('');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setFormError('This image is larger than 10 MB. Choose a smaller photo.');
      setFile(null);
      setPreview('');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFormError('');
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !cropType) { setFormError(!file ? 'Add a leaf photo to continue.' : 'Select a crop type to continue.'); return; }
    setFormError('');
    const imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The image could not be read. Choose another photo and try again.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(file);
    }).catch(error => { setFormError(error instanceof Error ? error.message : 'The image could not be read.'); return ''; });
    if (!imageData) return;
    create.mutate({ data: { imageData, originalFilename: file.name, cropType, ...(farmName.trim() ? { farmName: farmName.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) } }, {
      onSuccess: detection => {
        void queryClient.invalidateQueries({ queryKey: getListDetectionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setLocation(`/results/${detection.id}`);
      },
      onError: () => setFormError('We couldn’t save this detection. Please try again.'),
    });
  }
  return <div className="page-wrap narrow-page">
    <PageIntro eyebrow="NEW FIELD OBSERVATION" title="Check a leaf." detail="Add a clear photo and a little context. Your observation will be saved with the model’s actual response."/>
    <div className="upload-layout">
      <form className="upload-form" onSubmit={submit}>
        <section className="form-card">
          <div className="form-section-head"><span className="step-number">01</span><div><h2>Leaf photo</h2><p>One leaf, in focus, with natural light works best.</p></div></div>
          <label className={`dropzone ${preview ? 'has-preview' : ''}`} htmlFor="leaf-upload" data-testid="input-leaf-upload"
            onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}>
            {preview ? <><img src={preview} alt="Selected leaf to analyze" className="upload-preview"/><span className="preview-change"><Upload size={14}/> Choose a different photo</span></> :
              <span className="dropzone-inner"><span className="upload-icon"><CloudUpload size={23}/></span><b>Drop a leaf photo here</b><span>or <span className="browse-link">Browse image</span></span><small>JPG, JPEG, or PNG · up to 10 MB</small></span>}
            <input ref={fileInput} id="leaf-upload" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={event => chooseFile(event.target.files?.[0])}/>
          </label>
          {file && <div className="selected-file"><FileImage size={15}/><span>{file.name}</span><button type="button" className="remove-file" onClick={() => { setFile(null); setPreview(''); setFormError(''); if (fileInput.current) fileInput.current.value = ''; }}><X size={15}/><span>Remove Image</span></button></div>}
        </section>
        <section className="form-card">
          <div className="form-section-head"><span className="step-number">02</span><div><h2>Field details</h2><p>Help keep your observations easy to find.</p></div></div>
          <div className="form-grid">
            <label className="field"><span>Crop type <i>Required</i></span>
              {supported.length ? <select value={cropType} onChange={e => setCropType(e.target.value)} data-testid="select-crop-type"><option value="">Choose a crop</option>{supported.map(crop => <option key={crop} value={crop}>{crop}</option>)}</select>
                : <input value={cropType} onChange={e => setCropType(e.target.value)} placeholder={model.isLoading ? 'Loading supported crops…' : 'e.g. Tomato'} data-testid="input-crop-type"/>}
              {supported.length > 0 && <small>Supported by this model: {supported.join(', ')}</small>}
            </label>
            <label className="field"><span>Farm or field name <i>Optional</i></span><input value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="e.g. North field" data-testid="input-farm-name"/></label>
            <label className="field field-wide"><span>Field notes <i>Optional</i></span><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything you noticed about the plant or conditions…" rows={3} data-testid="input-notes"/></label>
          </div>
        </section>
        {formError && <div className="form-error" role="alert"><span><X size={14}/></span>{formError}</div>}
        <button className="button button-primary submit-detection" type="submit" disabled={create.isPending} data-testid="button-submit-detection">
          {create.isPending ? <><span className="button-loader"/> Analyzing Disease…</> : <>Analyze Disease <ArrowRight size={16}/></>}
        </button>
        <div className="form-assurance"><ShieldCheck size={15}/> Your image and notes are saved with this detection record.</div>
      </form>
      <aside className="upload-aside">
        <div className="aside-card readiness-card"><div className="aside-heading"><span className="aside-symbol"><Zap size={16}/></span><span>MODEL READINESS</span></div>
          {model.isLoading ? <div className="readiness-loading"><span className="skeleton readiness-bar"/><span className="skeleton readiness-bar short"/></div> : model.isError ? <><ModelPill ready={false}/><p>Model status could not be checked. The API will determine the result and report it explicitly.</p></> : <><ModelPill ready={model.data?.ready} message={model.data?.message}/><p>{model.data?.message}</p></>}
          {model.data?.engine && <div className="engine-line"><span>Engine</span><b>{model.data.engine}</b></div>}
        </div>
        <div className="aside-card photo-tips"><div className="aside-heading"><span className="aside-symbol"><Leaf size={16}/></span><span>PHOTO TIPS</span></div>
          <ul><li><span>01</span> Keep one leaf centered in frame</li><li><span>02</span> Use even, natural daylight</li><li><span>03</span> Avoid blur and busy backgrounds</li></ul>
        </div>
        <div className="honesty-card"><ShieldCheck size={17}/><p>A result is a model output, not a confirmed diagnosis. Consult a local agricultural expert before acting.</p><Link href="/about">Our limitations <ArrowRight size={13}/></Link></div>
      </aside>
    </div>
  </div>;
}

function ResultsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const detection = useGetDetection(id, { query: { queryKey: getGetDetectionQueryKey(id), enabled: !!id } });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteDetection();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const item = detection.data;
  const del = () => remove.mutate({ id }, { onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: getListDetectionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    setLocation('/history');
  } });
  if (detection.isLoading) return <div className="page-wrap"><LoadingPanel label="Opening your saved detection"/></div>;
  if (detection.isError || !item) return <div className="page-wrap"><PageIntro eyebrow="SAVED OBSERVATION" title="Detection not found." detail="This observation may have been removed, or it may not be available right now."/><ErrorPanel retry={() => detection.refetch()} label="We couldn’t open this detection."/><Link className="inline-link back-link" href="/history">Back to detection history <ArrowRight size={14}/></Link></div>;
  return <div className="page-wrap">
    <div className="back-crumb"><Link href="/history"><ArrowRight size={14}/> Detection history</Link><span>/</span><span>{item.originalFilename}</span></div>
    <div className="result-heading"><div><div className="eyebrow">FIELD OBSERVATION <span className="eyebrow-id">SC—{item.id.slice(0, 6).toUpperCase()}</span></div><h1>{item.disease || 'Detection details'}</h1><p>{item.cropType}{item.farmName ? ` · ${item.farmName}` : ''}<span className="meta-sep">·</span><DateText date={item.createdAt}/></p></div><div className="result-actions"><StatusBadge detection={item}/><button className="button button-outline-danger" onClick={() => setConfirmDelete(true)} data-testid="button-delete-detection"><Trash2 size={15}/> Delete</button></div></div>
    <div className="result-layout">
      <div className="result-visual">
        {item.imageUrl ? <img src={item.imageUrl} alt={`Uploaded image: ${item.originalFilename}`} data-testid="img-detection-leaf"/> : <div className="image-missing"><Leaf size={34}/><span>Image unavailable</span></div>}
        <div className="image-caption"><FileImage size={14}/><span>{item.originalFilename}</span></div>
      </div>
      <div className="result-detail">
        {item.status === 'diagnosed' ? <div className="diagnosis-card"><div className="diagnosis-top"><div className="diagnosis-check"><BadgeCheck size={20}/></div><div><span className="eyebrow">MODEL ASSESSMENT</span><h2>{item.disease || 'Assessment recorded'}</h2></div></div>
            {item.confidence !== null && item.confidence !== undefined && <div className="confidence-block"><div className="confidence-label"><span>Model confidence</span><b>{Math.round(item.confidence * 100)}%</b></div><div className="confidence-track"><span style={{ width: `${Math.max(0, Math.min(item.confidence * 100, 100))}%` }}/></div><small>Confidence is not certainty. Results depend on image quality and supported crop varieties.</small></div>}
            <div className="model-caveat"><ShieldCheck size={16}/><span>This is an automated assessment, not a confirmed diagnosis. Seek local expert advice before treatment.</span></div>
          </div> : <div className="unavailable-card"><div className="unavailable-symbol"><FlaskConical size={21}/></div><div><div className="eyebrow">NO MODEL ASSESSMENT</div><h2>Diagnosis unavailable</h2><p>The disease model was unavailable when this image was submitted. We’ve saved your observation, but no diagnosis was generated.</p></div><Link href="/detection" className="button button-soft">Try another image <ArrowRight size={15}/></Link></div>}
        {item.status === 'diagnosed' && item.recommendations?.length > 0 && <div className="recommendation-card"><div className="card-title-row"><div><div className="eyebrow">NEXT STEPS</div><h3>Recommendations</h3></div><span className="recommendation-mark"><Leaf size={17}/></span></div><ul>{item.recommendations.map((tip, index) => <li key={`${index}-${tip}`}><span className="rec-number">{String(index + 1).padStart(2, '0')}</span><span>{tip}</span></li>)}</ul></div>}
        <div className="detail-card"><div className="eyebrow">OBSERVATION DETAILS</div><div className="detail-grid"><div><span>Crop</span><b>{item.cropType}</b></div><div><span>Farm / field</span><b>{item.farmName || 'Not specified'}</b></div><div><span>Saved on</span><b><DateText date={item.createdAt}/></b></div><div><span>File name</span><b className="detail-filename">{item.originalFilename}</b></div></div>{item.notes && <div className="notes-block"><span>Field notes</span><p>{item.notes}</p></div>}</div>
      </div>
    </div>
    <div className="result-disclaimer"><ShieldCheck size={17}/><p><b>Use this result as one signal, not a final answer.</b> Model performance can vary by crop, variety, image quality, and field conditions. Confirm important decisions with a qualified local expert.</p><Link href="/about">About limitations <ArrowRight size={13}/></Link></div>
    {confirmDelete && <div className="modal-overlay" role="presentation" onClick={() => setConfirmDelete(false)}><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-btn" aria-label="Close" onClick={() => setConfirmDelete(false)}><X size={18}/></button><span className="confirm-icon"><Trash2 size={20}/></span><h2 id="delete-title">Delete this observation?</h2><p>This saved detection will be removed from your field log. This can’t be undone.</p><div className="modal-actions"><button className="button button-soft" onClick={() => setConfirmDelete(false)}>Keep detection</button><button className="button button-danger" onClick={del} disabled={remove.isPending}>{remove.isPending ? 'Deleting…' : 'Delete detection'}</button></div>{remove.isError && <div className="form-error">Could not delete this detection. Please try again.</div>}</div></div>}
  </div>;
}

function DashboardPage() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const data = summary.data;
  const days = data?.weeklyActivity ?? [];
  const max = Math.max(1, ...days.map(day => day.count));
  return <div className="page-wrap">
    <PageIntro eyebrow="FIELD ACTIVITY" title="Your field, over time." detail="A practical summary of the observations you’ve saved." action={<Link href="/detection" className="button button-primary"><Upload size={15}/> New detection</Link>}/>
    {summary.isLoading ? <LoadingPanel label="Loading activity summary"/> : summary.isError ? <ErrorPanel retry={() => summary.refetch()} label="Your activity summary is unavailable."/> : data && <>
      <div className="dashboard-stats">
        <div className="stat-card stat-main"><div className="stat-label"><span>All observations</span><FileImage size={17}/></div><b>{data.totalDetections}</b><span className="stat-note">In your field log</span></div>
        <div className="stat-card"><div className="stat-label"><span>Model assessed</span><BadgeCheck size={17}/></div><b>{data.diagnosedCount}</b><span className="stat-note">Assessment was returned</span></div>
        <div className="stat-card"><div className="stat-label"><span>Model unavailable</span><FlaskConical size={17}/></div><b>{data.modelUnavailableCount}</b><span className="stat-note">No diagnosis was generated</span></div>
        <div className="stat-card"><div className="stat-label"><span>Assessment rate</span><Activity size={17}/></div><b>{data.totalDetections ? Math.round(data.diagnosedCount / data.totalDetections * 100) : 0}<small>%</small></b><span className="stat-note">Of saved observations</span></div>
      </div>
      <div className="dashboard-charts">
        <section className="chart-card activity-chart"><div className="chart-head"><div><div className="eyebrow">THE LAST SEVEN DAYS</div><h2>Observation rhythm</h2></div><span className="chart-key"><i/> Detections</span></div>
          {days.length ? <div className="bar-chart">{days.map((day, i) => <div className="bar-col" key={`${day.date}-${i}`}><div className="bar-wrap"><span className="bar-count">{day.count || ''}</span><div className={`bar ${day.count ? 'bar-filled' : ''}`} style={{ height: `${Math.max(day.count ? 14 : 4, day.count / max * 100)}%` }}/></div><span className="bar-label">{new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>)}</div> : <div className="chart-empty"><Activity size={20}/><span>No activity to chart yet.</span></div>}
        </section>
        <section className="chart-card distribution-chart"><div className="chart-head"><div><div className="eyebrow">MODEL RESPONSES</div><h2>Disease distribution</h2></div><span className="chart-count">{data.diseaseDistribution.length} types</span></div>
          {data.diseaseDistribution.length ? <div className="distribution-list">{data.diseaseDistribution.slice(0, 6).map((entry, i) => {
            const total = Math.max(1, data.diseaseDistribution.reduce((sum, current) => sum + current.count, 0));
            return <div className="distribution-item" key={`${entry.disease}-${i}`}><div className="distribution-label"><span className={`distribution-swatch swatch-${i % 5}`}/><span>{entry.disease}</span><b>{entry.count}</b></div><div className="distribution-track"><span className={`swatch-fill-${i % 5}`} style={{ width: `${entry.count / total * 100}%` }}/></div></div>;
          })}</div> : <div className="chart-empty"><Leaf size={20}/><span>No disease distribution yet.</span></div>}
        </section>
      </div>
      <section className="home-section dashboard-recent"><div className="section-heading"><div><div className="eyebrow">LATEST OBSERVATIONS</div><h2>Recently saved</h2></div><Link className="inline-link" href="/history">Open field log <ArrowRight size={15}/></Link></div>
        {data.recentDetections.length ? <div className="list-card">{data.recentDetections.slice(0, 5).map(item => <DetectionRow item={item} key={item.id}/>)}</div> : <EmptyState title="Nothing in the field log yet" text="Save a first observation to start building a view of activity over time." action={<Link href="/detection" className="button button-primary">Make a detection <ArrowRight size={15}/></Link>}/>}
      </section>
    </>}
    <div className="dashboard-honesty"><ShieldCheck size={17}/><span>Unavailable model responses are counted separately and never treated as a diagnosis.</span><Link href="/about">How this works <ArrowRight size={13}/></Link></div>
  </div>;
}

function HistoryPage() {
  const [search, setSearch] = useState('');
  const [crop, setCrop] = useState('');
  const [deleteItem, setDeleteItem] = useState<Detection | null>(null);
  const queryParams = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(crop ? { cropType: crop } : {}), limit: 100 }), [search, crop]);
  const detections = useListDetections(queryParams, { query: { queryKey: getListDetectionsQueryKey(queryParams) } });
  const remove = useDeleteDetection();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const crops = [...new Set((detections.data ?? []).map(item => item.cropType))].sort();
  const doDelete = () => { if (!deleteItem) return; remove.mutate({ id: deleteItem.id }, { onSuccess: () => {
    setDeleteItem(null);
    void queryClient.invalidateQueries({ queryKey: getListDetectionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  } }); };
  return <div className="page-wrap">
    <PageIntro eyebrow="SAVED FIELD LOG" title="Detection history." detail="Find and revisit observations you’ve saved." action={<Link href="/detection" className="button button-primary"><Upload size={15}/> New detection</Link>}/>
    <div className="history-toolbar">
      <label className="search-field"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search crop, disease, field…" aria-label="Search saved detections" data-testid="input-search-detections"/>{search && <button onClick={() => setSearch('')} aria-label="Clear search" className="search-clear"><X size={15}/></button>}</label>
      <label className="filter-select"><Filter size={15}/><select value={crop} onChange={e => setCrop(e.target.value)} aria-label="Filter by crop" data-testid="select-filter-crop"><option value="">All crops</option>{crops.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <span className="history-count">{detections.data?.length ?? 0} {detections.data?.length === 1 ? 'observation' : 'observations'}</span>
    </div>
    {detections.isLoading ? <LoadingPanel label="Loading your detection history"/> : detections.isError ? <ErrorPanel retry={() => detections.refetch()} label="Couldn’t load saved detections."/> :
      detections.data?.length ? <div className="list-card history-list">{detections.data.map(item => <DetectionRow item={item} key={item.id} onDelete={setDeleteItem}/>)}</div> :
      <EmptyState title={search || crop ? 'No matching observations' : 'Your field log is empty'} text={search || crop ? 'Try a different search or clear the crop filter.' : 'Your saved observations will appear here after your first detection.'} action={search || crop ? <button className="button button-soft" onClick={() => { setSearch(''); setCrop(''); }}>Clear filters</button> : <Link href="/detection" className="button button-primary">Make a detection <ArrowRight size={15}/></Link>}/>}
    {deleteItem && <div className="modal-overlay" role="presentation" onClick={() => setDeleteItem(null)}><div className="confirm-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><button className="modal-close icon-btn" aria-label="Close" onClick={() => setDeleteItem(null)}><X size={18}/></button><span className="confirm-icon"><Trash2 size={20}/></span><h2>Delete this observation?</h2><p>“{deleteItem.originalFilename}” will be removed from your field log.</p><div className="modal-actions"><button className="button button-soft" onClick={() => setDeleteItem(null)}>Keep detection</button><button className="button button-danger" disabled={remove.isPending} onClick={doDelete}>{remove.isPending ? 'Deleting…' : 'Delete detection'}</button></div>{remove.isError && <div className="form-error">Could not delete. Please try again.</div>}</div></div>}
  </div>;
}

function AboutPage() {
  const model = useGetModelStatus({ query: { queryKey: getGetModelStatusQueryKey(), retry: 1 } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: 1 } });
  return <div className="page-wrap about-page">
    <section className="about-hero"><div className="eyebrow eyebrow-light"><span className="eyebrow-rule"/> A CLEARER VIEW, NOT A FINAL WORD</div><h1>Good field decisions<br/>start with <em>good questions.</em></h1><p>Smart Crop helps you save crop observations and see what an image model can—and can’t—tell you.</p><div className="about-health"><span className={`live-dot ${health.isError ? 'dot-off' : ''}`}/>{health.isLoading ? 'Checking service' : health.data ? 'Service online' : 'Service status unavailable'}<span className="about-health-sep"/> {model.isLoading ? 'Checking model' : model.data?.ready ? 'Disease model ready' : 'Disease model unavailable'}</div></section>
    <section className="about-content">
      <div className="about-main">
        <div className="about-section"><div className="eyebrow">WHAT SMART CROP DOES</div><h2>A field log with an extra lens.</h2><p>Upload a leaf image, add the crop and field context, and keep a record of the model’s response. When the model is ready, the platform reports the result it returns. When it isn’t, your observation is still saved—with no diagnosis invented to fill the gap.</p></div>
        <div className="process-list">
          <div className="process-step"><span>01</span><div><h3>Share a clear image</h3><p>Choose a focused photo of a single leaf. Lighting and image quality can affect the model response.</p></div><FileImage size={19}/></div>
          <div className="process-step"><span>02</span><div><h3>Add field context</h3><p>Record the crop, farm or field name, and any notes you want to keep alongside the image.</p></div><Wheat size={19}/></div>
          <div className="process-step"><span>03</span><div><h3>Review the actual response</h3><p>See the model status, any returned assessment, and the observation you saved—all in one place.</p></div><Activity size={19}/></div>
        </div>
      </div>
      <aside className="model-facts">
        <div className="eyebrow">MODEL STATUS</div>
        {model.isLoading ? <div className="readiness-loading"><span className="skeleton readiness-bar"/><span className="skeleton readiness-bar short"/></div> : model.isError ? <><ModelPill ready={false}/><p>Model status is currently unavailable. Try again later.</p></> : model.data && <>
          <ModelPill ready={model.data.ready} message={model.data.message}/><p className="model-message">{model.data.message}</p>
          <div className="fact-line"><span>Engine</span><b>{model.data.engine || 'Not specified'}</b></div>
          <div className="fact-line fact-crops"><span>Supported crops</span><b>{model.data.supportedCrops.length ? model.data.supportedCrops.join(', ') : 'None listed'}</b></div>
        </>}
        <div className="facts-rule"/>
        <div className="eyebrow">IMPORTANT LIMITATIONS</div>
        <ul className="limitations-list"><li>Predictions can be wrong, even when confidence appears high.</li><li>Results may not generalize across varieties, locations, or growing conditions.</li><li>A photo cannot replace in-person inspection or lab testing.</li><li>Do not make treatment decisions based on a model response alone.</li></ul>
        <div className="expert-callout"><ShieldCheck size={17}/><span>For important crop decisions, consult a qualified local agricultural expert.</span></div>
      </aside>
    </section>
    <section className="about-bottom"><div className="about-bottom-icon"><FlaskConical size={20}/></div><div><h2>Sometimes the honest answer is “not available.”</h2><p>If the Keras model is not ready, Smart Crop records that state clearly and does not substitute a fabricated disease result.</p></div><Link href="/detection" className="button button-primary">Try a detection <ArrowRight size={15}/></Link></section>
  </div>;
}

function Router() {
  return <Switch>
    <Route path="/"><Shell><Overview/></Shell></Route>
    <Route path="/detection"><Shell><DetectionPage/></Shell></Route>
    <Route path="/results/:id"><Shell><ResultsPage/></Shell></Route>
    <Route path="/dashboard"><Shell><DashboardPage/></Shell></Route>
    <Route path="/history"><Shell><HistoryPage/></Shell></Route>
    <Route path="/about"><Shell><AboutPage/></Shell></Route>
    <Route component={NotFound}/>
  </Switch>;
}
export default function App() {
  return <QueryClientProvider client={client}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter></QueryClientProvider>;
}
