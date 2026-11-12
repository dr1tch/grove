import {
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpRight,
  Check,
  FileImage,
  FileText,
  Folder,
  Laptop,
  Monitor,
  PencilLine,
  Plus,
  Smartphone,
  Sparkles,
} from "lucide-react";
import github from "./assets/github.png";
import mark from "../../../resources/brand/grove-mark.svg";
import desktop from "./assets/desktop.png";
import phone from "./assets/phone-preview.png";

const repository = "https://github.com/dr1tch/grove";
const release = `${repository}/releases/latest`;
const questions = [
  [
    "Will it change my Obsidian vault?",
    "Grove opens the folder in place. There is no import and no conversion. Notes remain Markdown and drawings keep their original format. Grove stores its own history and recovery data alongside your files. Back up important folders before trying this early build.",
  ],
  [
    "Can an agent edit without asking?",
    "Claude and Codex on desktop propose changes for you to review. A proposal only writes to your vault when you accept it. The assistant uses your signed-in desktop CLI.",
  ],
  [
    "What if a file changes elsewhere?",
    "Grove detects outside changes. If you and another editor change a note, you can compare the versions before saving. Git sync keeps conflicting edits in separate files for review.",
  ],
  [
    "How does sync work?",
    "On desktop, Git sync connects your vault to a private GitHub repository. Enable it in Settings → Sync. Phone and browser clients are planned; they are not available yet.",
  ],
  [
    "What does it cost?",
    "Grove is free and open source under the MIT license. It does not require a Grove account. Any usage charges for your chosen assistant provider are separate.",
  ],
];

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="Grove home">
      <img src={mark} width="38" height="38" alt="" />
      Grove
    </a>
  );
}

function Actions() {
  return (
    <div className="actions">
      <a className="button primary" href={release}>
        <ArrowDownToLine size={17} aria-hidden="true" />
        Download for Linux
      </a>
      <a className="button secondary" href={repository}>
        <img className="github-icon" src={github} width="18" height="18" alt="" />
        View on GitHub
      </a>
    </div>
  );
}

function SyncDiagram() {
  return (
    <div
      className="sync-diagram"
      role="img"
      aria-label="Desktop vault syncs with a private GitHub repository. Phone and web connections are planned."
    >
      <div className="sync-node">
        <Laptop aria-hidden="true" />
        <span>Desktop vault</span>
      </div>
      <ArrowDownUp className="sync-arrow" aria-hidden="true" />
      <div className="sync-node repository">
        <img className="github-icon" src={github} width="25" height="25" alt="" />
        <span>Private GitHub repo</span>
      </div>
      <div className="planned-connections">
        <ArrowDownUp aria-hidden="true" />
        <ArrowDownUp aria-hidden="true" />
      </div>
      <div className="planned-nodes">
        <div className="sync-node planned">
          <Smartphone aria-hidden="true" />
          <span>
            Phone<small>Coming soon</small>
          </span>
        </div>
        <div className="sync-node planned">
          <Monitor aria-hidden="true" />
          <span>
            Web<small>Coming soon</small>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header id="top" className="site-header wrap">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#phone">Phone</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="button primary header-download" href={release}>
          Download
        </a>
      </header>
      <main id="main">
        <section className="hero">
          <div className="wrap hero-copy">
            <p className="eyebrow">Local files. Connected ideas.</p>
            <h1>
              Your notes stay files.
              <br />
              <em>Everything else is help.</em>
            </h1>
            <p className="hero-description">
              Open a folder for Markdown, drawings and files. Connect ideas with
              <br className="desktop-break" /> links, preview what you need, and review agent
              proposals on desktop.
            </p>
            <Actions />
            <p className="fine-print">Free and open source. No Grove account.</p>
          </div>
          <figure className="desktop-shot wrap">
            <img
              src={desktop}
              width="1440"
              height="900"
              alt="Grove desktop with a Markdown launch plan, flowchart, table and tasks beside a TypeScript preview"
              fetchPriority="high"
            />
          </figure>
        </section>
        <section id="features" className="promises section-white">
          <div className="wrap">
            <p className="eyebrow">Why Grove</p>
            <h2>Three promises, kept on disk.</h2>
            <div className="promise-grid">
              <article>
                <Folder aria-hidden="true" />
                <h3>Plain files, opened in place</h3>
                <p>
                  Open a folder and start writing. Notes are Markdown files and everything stays in
                  your own folder.
                </p>
              </article>
              <article>
                <Sparkles aria-hidden="true" />
                <h3>Agents propose, you decide</h3>
                <p>Claude and Codex on desktop. Review changes before accepting.</p>
              </article>
              <article>
                <PencilLine aria-hidden="true" />
                <h3>Drawings that stay editable</h3>
                <p>Excalidraw files stay in their original format.</p>
              </article>
            </div>
          </div>
        </section>
        <section id="how-it-works" className="sync-section">
          <div className="wrap two-columns">
            <div>
              <p className="eyebrow">How it works</p>
              <h2>
                Your vault. Your GitHub
                <br className="desktop-break" /> repository.
              </h2>
              <p>
                Desktop sync uses Git. Changes sync through your private repository. Conflicting
                edits are kept as separate files for review.
              </p>
              <div
                className="conflict-example"
                aria-label="Example of conflicting versions preserved as separate files"
              >
                <div>
                  <strong>Your note</strong>
                  <pre>- Plan for release{"\n"}- Update timeline</pre>
                </div>
                <div>
                  <strong>Conflict copy</strong>
                  <pre>- Plan for release{"\n"}- Different timeline</pre>
                </div>
              </div>
            </div>
            <SyncDiagram />
          </div>
        </section>
        <section className="formats-section section-white">
          <div className="wrap two-columns">
            <div>
              <p className="eyebrow">Your whole vault</p>
              <h2>
                Opens what’s already in
                <br className="desktop-break" /> the folder.
              </h2>
              <p>
                On desktop, Grove opens and edits the files already in your folder. Work with notes,
                drawings, documents and media in their native formats.
              </p>
              <p>New notes begin as drafts. Choose a name and folder when you save.</p>
            </div>
            <div>
              <dl className="formats">
                <div>
                  <dt>
                    <FileText className="blue" aria-hidden="true" />
                    Notes
                  </dt>
                  <dd>
                    <span>Edit</span>
                    <span>Preview</span>
                  </dd>
                </div>
                <div>
                  <dt>
                    <PencilLine className="purple" aria-hidden="true" />
                    Drawings
                  </dt>
                  <dd>
                    <span>Edit</span>
                  </dd>
                </div>
                <div>
                  <dt>
                    <FileText className="red" aria-hidden="true" />
                    PDF, images, Office
                  </dt>
                  <dd>
                    <span>Preview</span>
                  </dd>
                </div>
                <div>
                  <dt>
                    <FileImage className="pink" aria-hidden="true" />
                    Audio and video
                  </dt>
                  <dd>
                    <span>Play</span>
                  </dd>
                </div>
              </dl>
              <p className="format-caption">
                Original-format drawings, Markdown, document previews, audio and video players.
              </p>
            </div>
          </div>
        </section>
        <section id="phone" className="phone-section">
          <div className="wrap two-columns">
            <div className="phone-copy">
              <p className="eyebrow">On your phone · Coming soon</p>
              <h2>The same vault, in your pocket.</h2>
              <ul>
                {[
                  "Read and edit Markdown",
                  "Move between notes with Files and Recent",
                  "Sync through your private GitHub repository",
                  "Keep opened notes available offline",
                ].map((text) => (
                  <li key={text}>
                    <Check aria-hidden="true" />
                    {text}
                  </li>
                ))}
              </ul>
              <p>Native phone and browser apps are planned.</p>
            </div>
            <figure className="phone-preview">
              <img
                src={phone}
                width="853"
                height="1844"
                alt="Proposed Grove phone Files screen with Recent notes, folders and a floating circular add button"
                loading="lazy"
              />
              <figcaption>Phone design preview. App coming soon.</figcaption>
            </figure>
          </div>
        </section>
        <section id="faq" className="faq-section">
          <div className="faq-wrap">
            <p className="eyebrow">Questions</p>
            <h2>Before you point it at your notes.</h2>
            <div className="faq-list">
              {questions.map(([question, answer], index) => (
                <details key={question} name="faq" open={index === 0}>
                  <summary>
                    {question}
                    <Plus size={17} aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
          <div className="wrap final-cta">
            <h2>Open a folder. Start writing.</h2>
            <Actions />
            <p className="fine-print">Linux available. Windows, web and phone coming.</p>
            <a className="install-link" href={`${repository}#install`}>
              Installation instructions <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <footer className="site-footer wrap">
        <Brand />
        <nav aria-label="Footer navigation">
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
          <a href={repository}>GitHub</a>
          <a href="#top">Back to top</a>
        </nav>
      </footer>
    </>
  );
}
