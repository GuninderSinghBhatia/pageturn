import { CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { DownloadButton, secondaryButton } from '@/components/DownloadButton'
import { FeatureShowcase, type Feature } from '@/components/FeatureShowcase'
import { Footer } from '@/components/Footer'
import { Nav } from '@/components/Nav'
import { TourVideo } from '@/components/TourVideo'
import { DOWNLOAD_URL, latestVersion } from '@/lib/site'

export const revalidate = 3600

/** The AI first, each with a few seconds of the real app cropped to where it happens. */
const FEATURES: Feature[] = [
  {
    clip: 'ask',
    title: 'Ask the book',
    body: 'Ask anything. The answer comes from the book itself and cites its pages; click one to go there. Spoiler Shield keeps it to the pages you have read.'
  },
  {
    clip: 'who',
    title: 'Who is this?',
    body: 'Right click a name for everything the book has said about it so far, and nothing past your page.'
  },
  {
    clip: 'lookup',
    title: 'Look it up in place',
    body: 'Select a word for a Wikipedia summary, or search the web beside the page without leaving the book.'
  },
  {
    clip: 'highlight',
    title: 'And a real book reader',
    body: 'Page turns like paper, highlights, notes beside the line, a pen for the margins, light, sepia or dark, and a notebook for every book.'
  }
]

/** How an answer is built, in the order it happens. */
const PIPELINE = [
  {
    step: 'Vector RAG',
    body: 'The book is split into 500 character passages, embedded with all-MiniLM-L6-v2 and stored in Chroma. A question finds its closest passages in milliseconds.'
  },
  {
    step: 'Graph RAG',
    body: 'An LLM reads each passage and pulls out terms and how they relate, stored as a knowledge graph in Neo4j. Questions about connections follow the links.'
  },
  {
    step: 'Grounded answer',
    body: 'Only the retrieved passages go to the model, which answers from them and cites every page. Spoiler Shield drops anything past the page you are on.'
  }
]

/** Golden-set results, hit@3 = the right page is among the top three passages. */
const RESULTS = [
  { label: '25 questions across the whole book', vector: '80%', graph: '8%', both: '76%' },
  { label: '15 questions about how terms relate', vector: '80%', graph: '53%', both: '87%' },
  { label: 'Average retrieval time', vector: '0.03 s', graph: '0.10 s', both: '0.15–0.21 s' }
]

const schema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PageTurn',
  operatingSystem: 'Windows 10, Windows 11',
  applicationCategory: 'UtilitiesApplication',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  downloadUrl: DOWNLOAD_URL
}

/** A two-tone heading: the first line in ink, the second muted with one orange word. */
function Heading({
  first,
  second,
  accent,
  as: Tag = 'h2',
  className = ''
}: {
  first: string
  second: string
  accent: string
  as?: 'h1' | 'h2'
  className?: string
}): React.JSX.Element {
  return (
    <Tag className={`font-semibold tracking-[-0.035em] ${className}`}>
      <span className="block">{first}</span>
      <span className="block text-ink/40">
        {second} <span className="text-spark">{accent}</span>
      </span>
    </Tag>
  )
}

export default async function Home(): Promise<React.JSX.Element> {
  const version = await latestVersion()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <Nav />
      <main id="main">
        {/* Hero: the promise, then the whole tour playing in an app window. */}
        <section id="top" className="relative overflow-hidden px-6 pt-36 pb-20 md:pt-44 md:pb-28">
          <div className="dots pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto max-w-5xl">
            <div className="settle flex flex-col items-center text-center">
              <a
                href="#rag"
                className="mb-7 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full border border-ink/10 bg-white px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:border-ink/20 hover:text-ink"
              >
                <span className="font-semibold text-ink">A RAG app</span>
                <span aria-hidden>·</span>
                vector RAG + graph RAG
                <span aria-hidden>·</span>
                <span className="tabular-nums">87% on a golden set</span>
                <span aria-hidden className="text-spark">→</span>
              </a>
              <Heading
                as="h1"
                first="Read with an AI"
                second="that knows"
                accent="your book."
                className="text-5xl leading-[1.02] sm:text-6xl md:text-7xl"
              />
              <p className="mt-7 max-w-xl text-lg text-ink-soft">
                PageTurn opens any PDF as a two page book with an assistant built in. Ask the book
                anything and get answers with page numbers, find out who a character is without
                spoilers, or have a passage explained.
              </p>
              <div className="mt-9 grid w-full max-w-xs gap-3 sm:flex sm:max-w-none sm:items-center sm:justify-center">
                <DownloadButton />
                <a href="#features" className={`${secondaryButton} px-5 py-3 text-base`}>
                  See the features
                </a>
              </div>
              <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-ink-soft">
                {['Free, no account', `Windows 10 and 11 · 5 MB${version ? ` · v${version}` : ''}`, 'No spoilers past your page'].map(
                  (t) => (
                    <li key={t} className="flex items-center gap-1.5 tabular-nums">
                      <CheckCircle size={16} weight="fill" className="shrink-0 text-brand" aria-hidden />
                      {t}
                    </li>
                  )
                )}
              </ul>
            </div>
            <div id="tour" className="settle mt-16 scroll-mt-28 md:mt-20" style={{ '--settle-delay': '180ms' } as React.CSSProperties}>
              <TourVideo />
            </div>
          </div>
        </section>

        {/* Features: the assistant first, then the reader, in one player. */}
        <section id="features" className="scroll-mt-24 border-t border-ink/8 bg-canvas-2 px-6 py-20 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
              <Heading first="An assistant that" second="reads along" accent="with you." className="text-4xl leading-[1.05] md:text-5xl" />
              <p className="mt-5 text-base text-ink-soft">
                Filmed in the real app, with a public domain copy of Alice in Wonderland. Pick a
                feature to watch it.
              </p>
            </div>
            <FeatureShowcase features={FEATURES} />
            <div className="mx-auto mt-14 max-w-3xl border-t border-ink/8 pt-8 text-center text-sm text-ink-soft">
              <p>
                <span className="font-semibold text-ink">Explain a passage:</span> select it and press
                Ctrl+E with your own Claude, ChatGPT or Gemini key, kept encrypted on your computer.
              </p>
              <p className="mt-3 text-xs">
                Ask the book and Who is this are a preview: they use the PageTurn AI service, which
                runs on your computer and ships separately for now.
              </p>
            </div>
          </div>
        </section>
        {/* How it works: the RAG pipeline and what it scored on a golden set. */}
        <section id="rag" className="scroll-mt-24 border-t border-ink/8 px-6 py-20 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <Heading first="Built on RAG." second="Measured on a" accent="golden set." className="text-4xl leading-[1.05] md:text-5xl" />
              <p className="mt-5 text-base text-ink-soft">
                Ask the book is retrieval augmented generation: the model never answers from memory,
                only from passages found in your book. Two retrievers work together.
              </p>
            </div>

            <ol className="mt-14 grid gap-4 md:grid-cols-3">
              {PIPELINE.map((p, i) => (
                <li key={p.step} className="rounded-2xl border border-ink/8 bg-white p-6">
                  <span className="text-sm font-semibold text-brand tabular-nums">{i + 1}</span>
                  <h3 className="mt-2 text-lg font-semibold">{p.step}</h3>
                  <p className="mt-1.5 text-sm text-ink-soft">{p.body}</p>
                </li>
              ))}
            </ol>

            <div className="mx-auto mt-14 max-w-3xl">
              <table className="w-full text-left text-sm tabular-nums">
                <caption className="mb-4 text-left text-base font-semibold text-ink">
                  Right page in the top three passages (hit@3)
                </caption>
                <thead className="text-xs text-ink-soft">
                  <tr className="border-b border-ink/10">
                    <th scope="col" className="py-2 font-medium">Question set</th>
                    <th scope="col" className="py-2 text-right font-medium">Vector</th>
                    <th scope="col" className="py-2 pl-4 text-right font-medium">Graph only</th>
                    <th scope="col" className="py-2 pl-4 text-right font-medium">Vector + graph</th>
                  </tr>
                </thead>
                <tbody>
                  {RESULTS.map((r) => (
                    <tr key={r.label} className="border-b border-ink/8">
                      <th scope="row" className="py-3 pr-4 font-normal text-ink-soft">{r.label}</th>
                      <td className="py-3 text-right font-semibold text-ink">{r.vector}</td>
                      <td className="py-3 pl-4 text-right text-ink-soft">{r.graph}</td>
                      <td className="py-3 pl-4 text-right font-semibold text-ink">{r.both}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-sm text-ink-soft">
                Off-topic questions refused: 4 of 4. Right page within one page: 84%. The graph alone
                finds the right neighbourhood but not the exact page; paired with vectors it lifts
                relationship questions from 80% to 87%. A table of contents tree retriever also
                scored 80% but cost about 2,450 LLM tokens per question, so plain vectors stay the
                default.
              </p>
              <p className="mt-6 text-xs text-ink-soft">
                Measured on a 991 page technical book (2,990 passages) with question sets whose
                page numbers were checked against the PDF. The graph so far covers one 100 page
                chapter (1,019 terms, 1,136 links), so it only switches on inside it; the graph row
                is scored there. The sets are small, so one question moves a score by 4 to 7
                points. These scores measure retrieval (whether the right page is found), not
                the wording of the final answer. Stack: FastAPI, LangChain, Chroma, Neo4j and gpt-oss-120b on Groq.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
