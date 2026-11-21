import { useEffect, useState } from 'react'
import { getProductImage } from '../../api/client'

export default function ProductImage({ id, externalUrl, thumb = false, alt = '', className = '' }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    setUrl('')
    if (!id) { setUrl(''); return }
    let live = true
    let objectUrl = ''
    getProductImage(id, thumb).then(blob => {
      objectUrl = URL.createObjectURL(blob)
      if (live) { setUrl(objectUrl) }
      else { URL.revokeObjectURL(objectUrl) }
    }).catch(() => { if (live) { setUrl('') } })
    return () => { live = false; if (objectUrl) { URL.revokeObjectURL(objectUrl) } }
  }, [id, thumb])
  return url || (!id && externalUrl) ? <img className={className} src={url || externalUrl} alt={alt} /> :
    <div className={`catalogue-image-placeholder ${className}`} aria-label="No product image">No image</div>
}
