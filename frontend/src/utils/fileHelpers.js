export function getFileType(filename) {
  const ext = filename.split(".").pop().toLowerCase()
  if (ext === "pdf")  return "pdf"
  if (["doc","docx"].includes(ext)) return "docx"
  if (["py","js","ts","jsx","tsx","json","yaml","yml","sh"].includes(ext)) return "code"
  return "txt"
}

export function getFileLabel(filename) {
  const ext = filename.split(".").pop().toUpperCase()
  return ext.length > 4 ? ext.slice(0,4) : ext
}

// Accepted types for the file input
export const ACCEPTED_TYPES = [
  ".pdf",".txt",".md",
  ".doc",".docx",
  ".py",".js",".ts",".jsx",".tsx",
  ".json",".yaml",".yml",".sh",".csv"
].join(",")