import { Box, Boxes, File, FileText } from 'lucide-react'

/**
 * A file's kind as a quiet row icon (16px, the row's grey): drawing or PDF, part, assembly, or
 * any other file. For lists in panes and reviews; the explorer keeps its thumbnails.
 */
export function FileKindIcon({ extension, size = 16 }: { extension: string | null; size?: number }) {
  const ext = (extension ?? '').toLowerCase().replace(/^\./, '')
  if (ext === 'slddrw' || ext === 'pdf') return <FileText size={size} />
  if (ext === 'sldprt') return <Box size={size} />
  if (ext === 'sldasm') return <Boxes size={size} />
  return <File size={size} />
}
