# Servidor HTTP estatico concorrente (TcpListener + RunspacePool) para a rede local.
# Serve os arquivos da pasta atual. Uso: pwsh ./serve.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080
$prefixIp = '0.0.0.0'

# Bloco que atende UMA conexao (roda em uma thread do pool).
$handler = {
  param($client, $root)

  $mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.webp' = 'image/webp'
    '.pdf'  = 'application/pdf'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
  }

  try {
    $client.ReceiveTimeout = 8000
    $client.SendTimeout    = 30000
    $stream = $client.GetStream()
    $stream.ReadTimeout  = 8000
    $stream.WriteTimeout = 30000
    $reader = [System.IO.StreamReader]::new($stream)

    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { return }

    # Drena os cabecalhos
    while ($true) { $l = $reader.ReadLine(); if ([string]::IsNullOrEmpty($l)) { break } }

    $parts = $requestLine -split ' '
    $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
    $path = ($rawPath -split '\?')[0]
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }

    $decoded = [System.Uri]::UnescapeDataString($path).TrimStart('/')
    $full = Join-Path $root $decoded
    $fullResolved = [System.IO.Path]::GetFullPath($full)

    if (($fullResolved.StartsWith([System.IO.Path]::GetFullPath($root))) -and (Test-Path $fullResolved -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($fullResolved)
      $ext = [System.IO.Path]::GetExtension($fullResolved).ToLower()
      $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($bytes, 0, $bytes.Length)
    } else {
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 - nao encontrado')
      $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    }
    $stream.Flush()
  } catch {
    # ignora erros de conexao individuais
  } finally {
    try { $client.Close() } catch {}
  }
}

# Pool de threads para atender varias conexoes em paralelo.
$pool = [RunspaceFactory]::CreateRunspacePool(1, 32)
$pool.Open()

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($prefixIp), $port)
$listener.Start()
Write-Host "Servidor no ar em http://$prefixIp`:$port  (raiz: $root)"
Write-Host "Pressione Ctrl+C para parar."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($client).AddArgument($root)
    # Dispara assincrono e descarta o resultado (a thread se encerra sozinha).
    [void]$ps.BeginInvoke()
  }
} finally {
  $listener.Stop()
  $pool.Close()
}
