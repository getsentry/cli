/** Copy text while retaining a small fallback for browsers without Clipboard API access. */
export function copyText(value: string): void {
  const fallbackCopy = () => {
    const input = document.createElement('textarea')
    input.value = value
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    document.execCommand?.('copy')
    input.remove()
  }

  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value).catch(fallbackCopy)
    return
  }

  fallbackCopy()
}
