import QRCode from 'qrcode'

// Scannable QR for a ZIP 321 payment URI: the standard 4-module quiet zone, high enough
// resolution for phone cameras, and medium error correction.
export function paymentQr(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    margin: 4,
    width: 360,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}
