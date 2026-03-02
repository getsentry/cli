#!/usr/bin/env bash
# Merges duplicate LCOV records for the same source file, taking the max hit
# count per line.  Designed for bun's LCOV output (TN/SF/FNF/FNH/DA/LF/LH).
# Usage: merge-lcov.sh input.info > output.info

awk '
/^SF:/ { f = substr($0, 4) }
/^FNF:/ { v = substr($0, 5)+0; if (v > fnf[f]) fnf[f] = v }
/^FNH:/ { v = substr($0, 5)+0; if (v > fnh[f]) fnh[f] = v }
/^DA:/ {
  split(substr($0, 4), a, ",")
  k = f SUBSEP a[1]
  v = a[2]+0
  if (!(k in d) || v > d[k]) d[k] = v
  if (!(k in s)) { s[k] = 1; o[f] = o[f] " " a[1] }
  F[f] = 1
}
END {
  for (f in F) {
    print "TN:"
    print "SF:" f
    print "FNF:" fnf[f]+0
    print "FNH:" fnh[f]+0
    n = split(o[f], a, " ")
    lf = 0; lh = 0
    for (i = 1; i <= n; i++) {
      if (a[i] == "") continue
      k = f SUBSEP a[i]
      print "DA:" a[i] "," d[k]
      lf++
      if (d[k] > 0) lh++
    }
    print "LF:" lf
    print "LH:" lh
    print "end_of_record"
  }
}' "$1"
