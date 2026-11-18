import { useState, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderTree,
  Check,
  AlertCircle,
  Loader2,
  ChevronUp,
} from 'lucide-react'
import clsx from 'clsx'

/**
 * Builds a hierarchical tree from a flat list of scripts with folder paths.
 */
export function buildFolderTree(scripts, rootFolderName = 'Carpeta Raíz') {
  const folderSet = new Set()
  folderSet.add('') // root

  for (const s of scripts) {
    const f = s.folder || ''
    folderSet.add(f)
    if (f) {
      const parts = f.split('/')
      let cur = ''
      for (const p of parts) {
        cur = cur ? `${cur}/${p}` : p
        folderSet.add(cur)
      }
    }
  }

  const nodeMap = new Map()
  for (const f of folderSet) {
    const parts = f ? f.split('/') : []
    const name = parts.length === 0 ? (rootFolderName || 'Raíz') : parts[parts.length - 1]
    nodeMap.set(f, {
      id: f,
      name,
      children: [],
      scriptCount: 0,
      totalScriptCount: 0,
      successCount: 0,
      failedCount: 0,
      runningCount: 0,
      totalSuccessCount: 0,
      totalFailedCount: 0,
      totalRunningCount: 0,
    })
  }

  // Count direct scripts
  for (const s of scripts) {
    const f = s.folder || ''
    const node = nodeMap.get(f)
    if (node) {
      node.scriptCount++
      if (s.status === 'success') node.successCount++
      if (s.status === 'failed') node.failedCount++
      if (s.status === 'running') node.runningCount++
    }
  }

  // Hierarchy linking
  const sortedPaths = Array.from(folderSet).sort((a, b) => {
    const depthA = a ? a.split('/').length : 0
    const depthB = b ? b.split('/').length : 0
    if (depthA !== depthB) return depthA - depthB
    return a.localeCompare(b)
  })

  for (const f of sortedPaths) {
    if (!f) continue
    const parts = f.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    const parentNode = nodeMap.get(parentPath)
    const node = nodeMap.get(f)
    if (parentNode && node) {
      parentNode.children.push(node)
    }
  }

  // Bottom-up aggregation of totals
  function aggregate(node) {
    let tot = node.scriptCount
    let succ = node.successCount
    let fail = node.failedCount
    let run = node.runningCount
    for (const child of node.children) {
      aggregate(child)
      tot += child.totalScriptCount
      succ += child.totalSuccessCount
      fail += child.totalFailedCount
      run += child.totalRunningCount
    }
    node.totalScriptCount = tot
    node.totalSuccessCount = succ
    node.totalFailedCount = fail
    node.totalRunningCount = run
  }

  const rootNode = nodeMap.get('')
  if (rootNode) {
    aggregate(rootNode)
  }

  return rootNode
}

function TreeNode({
  node,
  depth = 0,
  selectedFolderId,
  expandedMap,
  onToggleExpand,
  onSelectFolder,
}) {
  const isSelected = selectedFolderId === node.id
  const hasChildren = node.children.length > 0
  const isExpanded = expandedMap[node.id] !== false // expanded by default

  const hasErrors = node.failedCount > 0 || node.totalFailedCount > 0
  const isRunning = node.runningCount > 0 || node.totalRunningCount > 0
  const isComplete =
    node.totalScriptCount > 0 &&
    node.totalSuccessCount === node.totalScriptCount &&
    !hasErrors

  return (
    <div>
      <div
        onClick={() => onSelectFolder(node.id)}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={clsx(
          'group flex items-center gap-1.5 py-1 px-2 rounded-lg text-xs cursor-pointer select-none transition-all',
          isSelected
            ? 'bg-brand-dark/50 text-white font-medium border border-brand/50 shadow-sm'
            : 'text-slate-300 hover:bg-surface-800/70 hover:text-white'
        )}
      >
        {/* Expand / collapse arrow */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(node.id)
            }}
            className="p-0.5 -ml-1 text-slate-500 hover:text-slate-200 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5 inline-block -ml-1" />
        )}

        {/* Folder icon */}
        {isExpanded || isSelected ? (
          <FolderOpen
            className={clsx(
              'w-3.5 h-3.5 flex-shrink-0',
              isSelected ? 'text-sky-400' : 'text-amber-400'
            )}
          />
        ) : (
          <Folder
            className={clsx(
              'w-3.5 h-3.5 flex-shrink-0',
              isSelected ? 'text-sky-400' : 'text-amber-400'
            )}
          />
        )}

        {/* Name */}
        <span className="truncate flex-1 font-mono text-[11px]" title={node.name}>
          {node.name}
        </span>

        {/* Status indicators */}
        {isRunning && (
          <Loader2 className="w-3 h-3 text-sky-400 animate-spin flex-shrink-0" />
        )}
        {hasErrors && (
          <div
            className="w-3.5 h-3.5 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center flex-shrink-0"
            title={`${node.totalFailedCount} script(s) con error`}
          >
            <AlertCircle className="w-2.5 h-2.5 text-red-400" />
          </div>
        )}
        {isComplete && (
          <div
            className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center flex-shrink-0"
            title="Todos los scripts ejecutados exitosamente"
          >
            <Check className="w-2.5 h-2.5 text-emerald-400 stroke-[3]" />
          </div>
        )}

        {/* Script count badge */}
        <span
          className={clsx(
            'text-[10px] px-1.5 py-0.2 rounded-md font-mono flex-shrink-0',
            isSelected
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold'
              : 'bg-surface-800 text-slate-400'
          )}
          title={`Scripts directos: ${node.scriptCount} (Total con subcarpetas: ${node.totalScriptCount})`}
        >
          {node.scriptCount}
        </span>
      </div>

      {/* Render children if expanded */}
      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              expandedMap={expandedMap}
              onToggleExpand={onToggleExpand}
              onSelectFolder={onSelectFolder}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ScriptFolderTree({
  scripts,
  rootFolderName,
  selectedFolderId,
  onSelectFolder,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [expandedMap, setExpandedMap] = useState({})

  const rootNode = useMemo(() => {
    return buildFolderTree(scripts, rootFolderName)
  }, [scripts, rootFolderName])

  const toggleExpand = (folderId) => {
    setExpandedMap((prev) => ({
      ...prev,
      [folderId]: prev[folderId] === false ? true : false,
    }))
  }

  if (!rootNode) return null

  // If there are no subfolders at all, we don't necessarily need the whole tree box,
  // but if rootNode has children or scripts, show it cleanly.
  const hasSubfolders = rootNode.children.length > 0

  return (
    <div className="flex flex-col rounded-xl border border-surface-600/70 bg-surface-900/60 overflow-hidden flex-shrink-0 transition-all duration-200">
      {/* Header bar */}
      <div
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex items-center justify-between px-3 py-1.5 bg-surface-800/80 border-b border-surface-600/60 cursor-pointer select-none hover:bg-surface-800 text-xs font-semibold text-slate-300"
      >
        <div className="flex items-center gap-1.5">
          <FolderTree className="w-3.5 h-3.5 text-amber-400" />
          <span>Árbol de Carpetas</span>
          <span className="text-[10px] text-slate-500 font-normal">
            ({rootNode.totalScriptCount} scripts en total)
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsCollapsed((prev) => !prev)
          }}
          className="p-1 text-slate-400 hover:text-white rounded"
          title={isCollapsed ? 'Expandir panel de carpetas' : 'Plegar panel de carpetas'}
        >
          {isCollapsed ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Tree content */}
      {!isCollapsed && (
        <div className="p-1.5 overflow-y-auto max-h-44 space-y-0.5">
          <TreeNode
            node={rootNode}
            depth={0}
            selectedFolderId={selectedFolderId}
            expandedMap={expandedMap}
            onToggleExpand={toggleExpand}
            onSelectFolder={onSelectFolder}
          />
        </div>
      )}
    </div>
  )
}
