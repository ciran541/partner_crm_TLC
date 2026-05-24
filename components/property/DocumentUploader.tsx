'use client'

import { useRef, useState } from 'react'
import { Upload, X, FileText } from 'lucide-react'

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_SIZE = 10 * 1024 * 1024

interface Props {
    onFileSelect: (file: File | null) => void
    selectedFile: File | null
}

function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentUploader({ onFileSelect, selectedFile }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragOver, setDragOver] = useState(false)
    const [fileError, setFileError] = useState<string | null>(null)

    function handleFile(file: File | null) {
        setFileError(null)
        if (!file) return
        if (!ACCEPTED_TYPES.includes(file.type)) {
            setFileError('Only PDF, JPEG, and PNG files are accepted.')
            return
        }
        if (file.size > MAX_SIZE) {
            setFileError('File must be under 10 MB.')
            return
        }
        onFileSelect(file)
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault()
        setDragOver(false)
        handleFile(e.dataTransfer.files[0] ?? null)
    }

    if (selectedFile) {
        return (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
                <FileText size={18} color="#059669" className="shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{selectedFile.name}</p>
                    <p className="text-xs text-slate-400">{formatSize(selectedFile.size)}</p>
                </div>
                <button
                    type="button"
                    onClick={() => { onFileSelect(null); setFileError(null) }}
                    className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                >
                    <X size={16} />
                </button>
            </div>
        )
    }

    return (
        <div>
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`w-full flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed transition-colors
                    ${dragOver
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    }`}
            >
                <Upload size={24} color={dragOver ? '#059669' : '#94a3b8'} />
                <div className="text-center">
                    <p className="text-sm font-medium text-slate-600">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-400 mt-0.5">PDF, JPEG or PNG — max 10 MB</p>
                </div>
            </button>
            <input
                ref={inputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0] ?? null)}
            />
            {fileError && <p className="mt-1.5 text-xs text-red-600">{fileError}</p>}
        </div>
    )
}
