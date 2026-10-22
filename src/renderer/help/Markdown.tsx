import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'
import styles from './Help.module.css'

/** An AI answer: Markdown with math (KaTeX) and highlighted code. Links open externally. */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
