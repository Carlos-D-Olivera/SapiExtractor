import { EditorState } from '@codemirror/state'
import { SearchQuery } from '@codemirror/search'

self.onmessage = ({ data: { generation, doc, query, wordChars } }) => {
  const state = EditorState.create({ doc, extensions: EditorState.languageData.of(() => wordChars.map(value => ({ wordChars: value }))) })
  const search = new SearchQuery(query), matches = []
  if (search.valid) for (const { from, to } of search.getCursor(state)) matches.push({ from, to })
  self.postMessage({ generation, matches })
}
