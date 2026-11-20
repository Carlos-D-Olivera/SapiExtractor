import { computeChangedLineMarks } from './editorChanges.js'

self.onmessage = ({ data: { requestId, openedSql, currentSql } }) => {
  self.postMessage({ requestId, marks: computeChangedLineMarks(openedSql, currentSql) })
}
