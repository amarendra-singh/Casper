export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export function rowFingerprint(row) {
  const { status: _status, errorMsg: _error, skuId: _skuId, bulkHold: _hold, ...data } = row
  return JSON.stringify(data)
}
