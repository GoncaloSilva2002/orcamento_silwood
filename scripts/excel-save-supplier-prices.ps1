param(
  [Parameter(Mandatory = $true)]
  [string]$WorkbookPath,

  [Parameter(Mandatory = $true)]
  [string]$PayloadPath,

  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory
  ,
  [string]$ComparisonWorkbookPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$excel = $null
$workbook = $null
$sheet = $null
$paintSheet = $null
$edgeSheet = $null
$drawerSheet = $null
$systemSheet = $null
$baseWoodSheet = $null
$comparisonWorkbook = $null
$comparisonSheet = $null
$sheetWasProtected = $false
$excelProcessIdsBefore = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })

function Convert-ExcelNumber {
  param(
    [object]$Value,
    [string]$Label
  )

  if ($null -eq $Value) { return $null }
  if ($Value -is [double] -or $Value -is [int] -or $Value -is [decimal]) { return [double]$Value }

  $text = ([string]$Value).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $text = $text -replace "\s", "" -replace "€", "" -replace ",", "."

  $number = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
    return $number
  }

  throw "Valor numerico invalido em ${Label}: '$Value'"
}

function Set-ExcelCellValue {
  param(
    [object]$Sheet,
    [int]$Row,
    [int]$Column,
    [object]$Value,
    [string]$Label
  )

  try {
    if ($Value -is [double] -or $Value -is [int] -or $Value -is [decimal]) {
      $Sheet.Cells.Item($Row, $Column).Value2 = [double]$Value
    } else {
      $Sheet.Cells.Item($Row, $Column).Value = [string]$Value
    }
  } catch {
    throw "Erro ao escrever ${Label} na celula linha $Row coluna ${Column}: $($_.Exception.Message)"
  }
}

function Test-FileWriteAccess {
  param([string]$Path)
  $stream = $null
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    return $true
  } catch {
    return $false
  } finally {
    if ($stream -ne $null) { $stream.Close() }
  }
}

function Remove-StaleExcelLockFile {
  param([string]$Path)
  $folder = [System.IO.Path]::GetDirectoryName($Path)
  $name = [System.IO.Path]::GetFileName($Path)
  $lockPath = Join-Path $folder ("~$" + $name)
  if (Test-Path -LiteralPath $lockPath) {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

function Normalize-Key {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  $text = [string]$Value
  $normalized = $text.Normalize([System.Text.NormalizationForm]::FormD)
  $builder = [System.Text.StringBuilder]::new()
  foreach ($char in $normalized.ToCharArray()) {
    $category = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($char)
    if ($category -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$builder.Append($char)
    }
  }
  return ($builder.ToString().ToUpperInvariant() -replace "[^\w\s]", " " -replace "\b(\d+)\s*MM\b", '$1MM' -replace "\s+", " ").Trim()
}

function Comparison-Key {
  param([object]$Family, [object]$Thickness)
  $cleanThickness = ([string]$Thickness) -replace "\s+", ""
  return Normalize-Key "$Family - $cleanThickness"
}

function Family-From-Reference {
  param([object]$Reference, [object]$Thickness)
  $text = ([string]$Reference).Trim()
  $cleanThickness = (([string]$Thickness) -replace "\s+", "").Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  if (-not [string]::IsNullOrWhiteSpace($cleanThickness)) {
    $pattern = "\s*-\s*" + [regex]::Escape($cleanThickness) + "\s*$"
    $text = $text -replace $pattern, ""
  }
  return $text.Trim()
}

try {
  $payloadText = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.Encoding]::UTF8)
  $payload = $payloadText | ConvertFrom-Json

  if (-not (Test-Path -LiteralPath $WorkbookPath)) {
    throw "O ficheiro Excel da pasta data nao foi encontrado."
  }

  if (Test-FileWriteAccess $WorkbookPath) {
    Remove-StaleExcelLockFile $WorkbookPath
  } else {
    throw "O ficheiro Excel esta bloqueado por outro processo do Windows."
  }

  [System.IO.Directory]::CreateDirectory($BackupDirectory) | Out-Null
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($WorkbookPath)
  $extension = [System.IO.Path]::GetExtension($WorkbookPath)
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = Join-Path $BackupDirectory "$baseName-$stamp$extension"
  Copy-Item -LiteralPath $WorkbookPath -Destination $backupPath -Force

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AutomationSecurity = 3

  $workbook = $excel.Workbooks.Open($WorkbookPath, 0, $false, [Type]::Missing, [Type]::Missing, [Type]::Missing, $true)
  if ($workbook.ReadOnly) {
    throw "O Excel esta aberto ou bloqueado. Feche o ficheiro e tente novamente."
  }

  foreach ($candidateSheet in $workbook.Worksheets) {
    if ([string]$candidateSheet.Name -match "Placas.*Seccionadora") {
      $sheet = $candidateSheet
      break
    }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($candidateSheet)
  }
  if ($sheet -eq $null) { throw "A folha de placas nao foi encontrada." }
  $sheetWasProtected = [bool]$sheet.ProtectContents
  if ($sheetWasProtected) { $sheet.Unprotect() }
  foreach ($candidateSheet in $workbook.Worksheets) {
    if ([string]$candidateSheet.Name -match "Base_Fornecedores Madeiras") {
      $baseWoodSheet = $candidateSheet
      break
    }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($candidateSheet)
  }
  $lastRow = $sheet.Cells.Item($sheet.Rows.Count, 1).End(-4162).Row
  $rowByName = @{}
  for ($row = 7; $row -le $lastRow; $row += 1) {
    $name = [string]$sheet.Cells.Item($row, 1).Value2
    if (-not [string]::IsNullOrWhiteSpace($name)) {
      $rowByName[$name.Trim()] = $row
    }
  }

  $updated = 0
  $insertedPlates = 0
  $insertedPlateSuppliers = 0
  foreach ($plate in $payload.plates) {
    $name = [string]$plate.name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $supplier = [string]$plate.supplier
    $reference = [string]$plate.reference
    if ([string]::IsNullOrWhiteSpace($reference)) { $reference = $name }
    $supplierPrice = Convert-ExcelNumber $plate.supplierPrice "placa '$name'"
    if ($null -eq $supplierPrice) { continue }

    if ($payload.addMissingPlates -and $baseWoodSheet -ne $null) {
      $lastBaseWoodRow = $baseWoodSheet.Cells.Item($baseWoodSheet.Rows.Count, 2).End(-4162).Row
      $baseExists = $false
      for ($baseRow = 14; $baseRow -le $lastBaseWoodRow; $baseRow += 1) {
        $baseName = [string]$baseWoodSheet.Cells.Item($baseRow, 2).Value2
        $baseReference = [string]$baseWoodSheet.Cells.Item($baseRow, 3).Value2
        $baseSupplier = [string]$baseWoodSheet.Cells.Item($baseRow, 11).Value2
        if ($baseName.Trim() -eq $name.Trim() -and $baseReference.Trim() -eq $reference.Trim() -and $baseSupplier.Trim() -eq $supplier.Trim()) {
          Set-ExcelCellValue $baseWoodSheet $baseRow 10 $supplierPrice "preco fornecedor base madeiras"
          $baseExists = $true
          break
        }
      }
      if (-not $baseExists) {
        $newBaseRow = [Math]::Max(14, $lastBaseWoodRow + 1)
        Set-ExcelCellValue $baseWoodSheet $newBaseRow 2 $name.Trim() "nome base madeiras"
        Set-ExcelCellValue $baseWoodSheet $newBaseRow 3 $reference.Trim() "referencia base madeiras"
        Set-ExcelCellValue $baseWoodSheet $newBaseRow 10 $supplierPrice "preco fornecedor base madeiras"
        Set-ExcelCellValue $baseWoodSheet $newBaseRow 11 $supplier.Trim() "fornecedor base madeiras"
        $insertedPlateSuppliers += 1
      }
    }

    if (-not $rowByName.ContainsKey($name.Trim())) {
      if (-not $payload.addMissingPlates) { continue }
      $lastRow += 1
      $row = $lastRow
      $rowByName[$name.Trim()] = $row
      Set-ExcelCellValue $sheet $row 1 $name.Trim() "nome placa"
      $sheet.Cells.Item($row, 5).Formula = "=IF(B$row>0, B$row+2.02, """")"
      $sheet.Cells.Item($row, 6).Formula = "=IF(E$row<>"""", E$row * (1 + `$H`$3), """")"
      $sheet.Cells.Item($row, 7).Formula = "=IF(E$row<>"""", E$row * (1 + `$H`$2), """")"
      $insertedPlates += 1
    } else {
      $row = $rowByName[$name.Trim()]
    }

    if ($payload.addMissingPlates -and $baseWoodSheet -ne $null) {
      $lastBaseWoodRow = $baseWoodSheet.Cells.Item($baseWoodSheet.Rows.Count, 2).End(-4162).Row
      $bestPrice = $supplierPrice
      $bestSupplier = $supplier
      $bestReference = $reference
      for ($baseRow = 14; $baseRow -le $lastBaseWoodRow; $baseRow += 1) {
        $baseName = [string]$baseWoodSheet.Cells.Item($baseRow, 2).Value2
        $basePrice = $baseWoodSheet.Cells.Item($baseRow, 10).Value2
        $numericBasePrice = Convert-ExcelNumber $basePrice "base madeiras '$name'"
        if ($baseName.Trim() -eq $name.Trim() -and $null -ne $numericBasePrice -and $numericBasePrice -gt 0 -and $numericBasePrice -lt $bestPrice) {
          $bestPrice = $numericBasePrice
          $bestSupplier = [string]$baseWoodSheet.Cells.Item($baseRow, 11).Value2
          $bestReference = [string]$baseWoodSheet.Cells.Item($baseRow, 3).Value2
        }
      }
      Set-ExcelCellValue $sheet $row 2 $bestPrice "melhor preco placa"
      Set-ExcelCellValue $sheet $row 3 $bestSupplier "melhor fornecedor placa"
      Set-ExcelCellValue $sheet $row 4 $bestReference "melhor referencia placa"
    } else {
      Set-ExcelCellValue $sheet $row 2 $supplierPrice "preco fornecedor placa"
      Set-ExcelCellValue $sheet $row 3 $supplier "fornecedor placa"
      Set-ExcelCellValue $sheet $row 4 $reference "referencia placa"
    }
    $updated += 1
  }

  $paintSheet = $null
  $edgeSheet = $null
  $drawerSheet = $null
  foreach ($candidateSheet in $workbook.Worksheets) {
    if ($paintSheet -eq $null -and [string]$candidateSheet.Name -match "Pintura") { $paintSheet = $candidateSheet; continue }
    if ($edgeSheet -eq $null -and [string]$candidateSheet.Name -match "Orlagem") { $edgeSheet = $candidateSheet; continue }
    if ($drawerSheet -eq $null -and [string]$candidateSheet.Name -match "Gavetas") { $drawerSheet = $candidateSheet; continue }
    if ($systemSheet -eq $null -and [string]$candidateSheet.Name -match "Sistema.*Abertura") { $systemSheet = $candidateSheet; continue }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($candidateSheet)
  }

  $updatedPaint = 0
  if ($paintSheet -ne $null -and $payload.paintingComponents) {
    $lastPaintRow = $paintSheet.Cells.Item($paintSheet.Rows.Count, 2).End(-4162).Row
    foreach ($component in $payload.paintingComponents) {
      $name = [string]$component.item
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      for ($row = 18; $row -le $lastPaintRow; $row += 1) {
        $candidate = [string]$paintSheet.Cells.Item($row, 2).Value2
        if ($candidate.Trim() -eq $name.Trim()) {
          $componentPrice = Convert-ExcelNumber $component.supplierPrice "pintura '$name'"
          if ($null -eq $componentPrice) { continue }
          $paintSheet.Cells.Item($row, 4).Value2 = $componentPrice
          $updatedPaint += 1
          break
        }
      }
    }
  }

  $updatedEdges = 0
  if ($edgeSheet -ne $null -and $payload.edges) {
    $lastEdgeRow = $edgeSheet.Cells.Item($edgeSheet.Rows.Count, 1).End(-4162).Row
    foreach ($edge in $payload.edges) {
      $name = [string]$edge.name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      for ($row = 2; $row -le $lastEdgeRow; $row += 1) {
        $candidate = [string]$edgeSheet.Cells.Item($row, 1).Value2
        if ($candidate.Trim() -eq $name.Trim()) {
          $edgePrice = Convert-ExcelNumber $edge.supplierPrice "orla '$name'"
          if ($null -eq $edgePrice) { continue }
          $edgeSheet.Cells.Item($row, 2).Value2 = $edgePrice
          $updatedEdges += 1
          break
        }
      }
    }
  }

  $updatedDrawers = 0
  if ($drawerSheet -ne $null -and $payload.drawerComponents) {
    $lastDrawerRow = $drawerSheet.Cells.Item($drawerSheet.Rows.Count, 1).End(-4162).Row
    $blocks = @(
      @{ Item = 1; Supplier = 2; Price = 3 },
      @{ Item = 7; Supplier = 8; Price = 9 },
      @{ Item = 13; Supplier = 14; Price = 15 }
    )
    foreach ($component in $payload.drawerComponents) {
      $name = [string]$component.item
      $supplier = [string]$component.supplier
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      foreach ($block in $blocks) {
        for ($row = 11; $row -le $lastDrawerRow; $row += 1) {
          $candidate = [string]$drawerSheet.Cells.Item($row, $block.Item).Value2
          $candidateSupplier = [string]$drawerSheet.Cells.Item($row, $block.Supplier).Value2
          $definition = $drawerSheet.Cells.Item($row, ($block.Price + 1)).Value2
          if ($candidate.Trim() -eq $name.Trim() -and ([string]::IsNullOrWhiteSpace($supplier) -or $candidateSupplier.Trim() -eq $supplier.Trim())) {
            $drawerPrice = Convert-ExcelNumber $component.supplierPrice "gaveta '$name'"
            if ($null -eq $drawerPrice) { continue }
            if ($definition -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$definition)) {
              $drawerSheet.Cells.Item($row, $block.Price).Value2 = $drawerPrice
            } else {
              $quantity = $drawerSheet.Cells.Item($row, $block.Price).Value2
              $unitCost = $drawerSheet.Cells.Item($row, ($block.Price + 1)).Value2
              if ($quantity -is [double] -and $unitCost -is [double]) {
                $drawerSheet.Cells.Item($row, ($block.Price + 1)).Value2 = $drawerPrice
              } else {
                continue
              }
            }
            $updatedDrawers += 1
          }
        }
      }
    }
  }

  $updatedSystems = 0
  if ($systemSheet -ne $null) {
    $systemBlocks = @(
      @{ Item = 4; Supplier = 5; Price = 6 },
      @{ Item = 13; Supplier = 14; Price = 15 },
      @{ Item = 22; Supplier = 23; Price = 24 },
      @{ Item = 31; Supplier = 32; Price = 33 }
    )
    $systemPayloads = @()
    if ($payload.hingeComponents) { $systemPayloads += $payload.hingeComponents }
    if ($payload.openingSystemComponents) { $systemPayloads += $payload.openingSystemComponents }
    $lastSystemRow = $systemSheet.Cells.Item($systemSheet.Rows.Count, 4).End(-4162).Row
    foreach ($component in $systemPayloads) {
      $name = [string]$component.item
      $supplier = [string]$component.supplier
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      foreach ($block in $systemBlocks) {
        for ($row = 11; $row -le $lastSystemRow; $row += 1) {
          $candidate = [string]$systemSheet.Cells.Item($row, $block.Item).Value2
          $candidateSupplier = [string]$systemSheet.Cells.Item($row, $block.Supplier).Value2
          if ($candidate.Trim() -eq $name.Trim() -and ([string]::IsNullOrWhiteSpace($supplier) -or $candidateSupplier.Trim() -eq $supplier.Trim())) {
            $systemPrice = Convert-ExcelNumber $component.supplierPrice "sistema/dobradica '$name'"
            if ($null -eq $systemPrice) { continue }
            $systemSheet.Cells.Item($row, $block.Price).Value2 = $systemPrice
            $updatedSystems += 1
          }
        }
      }
    }
  }

  $updatedExtras = 0
  if ($payload.extras) {
    $extraConfigs = @(
      @{ Group = "Puxadores"; Sheet = "Puxadores"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "Rodap"; Sheet = "Rodap"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "Acess"; Sheet = "Acess.*Cozinha"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "Cestos"; Sheet = "Cestos"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "LED"; Sheet = "Perfis.*Fitas LED|LED"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "Tomadas"; Sheet = "Tomadas"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "P.s|Fix"; Sheet = "P.s.*Fixa|Fix"; Item = 2; Supplier = 3; Price = 4 },
      @{ Group = "Roupeiro"; Sheet = "Acess.*Roupeiro"; Item = 2; Supplier = 3; Price = 4 }
    )
    foreach ($extra in $payload.extras) {
      $group = [string]$extra.group
      $name = [string]$extra.item
      $supplier = [string]$extra.supplier
      if ([string]::IsNullOrWhiteSpace($group) -or [string]::IsNullOrWhiteSpace($name)) { continue }
      foreach ($config in $extraConfigs) {
        if ($group -notmatch $config.Group) { continue }
        $extraSheet = $null
        foreach ($candidateSheet in $workbook.Worksheets) {
          if ([string]$candidateSheet.Name -match $config.Sheet) {
            $extraSheet = $candidateSheet
            break
          }
          [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($candidateSheet)
        }
        if ($extraSheet -eq $null) { continue }
        try {
          $lastExtraRow = $extraSheet.Cells.Item($extraSheet.Rows.Count, $config.Item).End(-4162).Row
          for ($row = 1; $row -le $lastExtraRow; $row += 1) {
            $candidate = [string]$extraSheet.Cells.Item($row, $config.Item).Value2
            $candidateSupplier = [string]$extraSheet.Cells.Item($row, $config.Supplier).Value2
            if ($candidate.Trim() -eq $name.Trim() -and ([string]::IsNullOrWhiteSpace($supplier) -or $candidateSupplier.Trim() -eq $supplier.Trim())) {
              $extraPrice = Convert-ExcelNumber $extra.supplierPrice "extra '$name'"
              if ($null -eq $extraPrice) { continue }
              $extraSheet.Cells.Item($row, $config.Price).Value2 = $extraPrice
              $updatedExtras += 1
              break
            }
          }
        }
        finally {
          if ($extraSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($extraSheet) }
        }
        break
      }
    }
  }

  $updatedComparison = 0
  if (-not [string]::IsNullOrWhiteSpace($ComparisonWorkbookPath) -and (Test-Path -LiteralPath $ComparisonWorkbookPath) -and $payload.plates) {
    $comparisonWorkbook = $excel.Workbooks.Open($ComparisonWorkbookPath, 0, $false)
    if ($comparisonWorkbook.ReadOnly) {
      throw "O ficheiro de comparacao de precos esta aberto ou bloqueado. Feche o ficheiro e tente novamente."
    }
    foreach ($candidateSheet in $comparisonWorkbook.Worksheets) {
      if ([string]$candidateSheet.Name -eq "PLACAS_26") {
        $comparisonSheet = $candidateSheet
        break
      }
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($candidateSheet)
    }
    if ($comparisonSheet -ne $null) {
      $lastComparisonRow = $comparisonSheet.Cells.Item($comparisonSheet.Rows.Count, 1).End(-4162).Row
      $supplierColumns = @{}
      foreach ($col in @(3,5,7,9,11)) {
        $supplierName = [string]$comparisonSheet.Cells.Item(4, $col).Value2
        $supplierKey = Normalize-Key $supplierName
        if (-not [string]::IsNullOrWhiteSpace($supplierKey)) { $supplierColumns[$supplierKey] = $col }
      }
      foreach ($plate in $payload.plates) {
        if ([string]$plate.comparisonSource -ne "PLACAS_26") { continue }
        $targetKey = [string]$plate.comparisonKey
        if ([string]::IsNullOrWhiteSpace($targetKey)) { $targetKey = Normalize-Key $plate.name }
        $supplierKey = Normalize-Key $plate.supplier
        $col = 0
        $directCol = Convert-ExcelNumber $plate.comparisonColumn "coluna comparador '$($plate.name)'"
        if ($null -ne $directCol) { $col = [int]$directCol }
        if ($col -lt 3 -or $col -gt 11 -or (($col - 3) % 2 -ne 0)) {
          if (-not $supplierColumns.ContainsKey($supplierKey)) { continue }
          $col = [int]$supplierColumns[$supplierKey]
        }
        $price = Convert-ExcelNumber $plate.supplierPrice "comparador '$($plate.name)'"
        if ($null -eq $price) { continue }
        $directRow = Convert-ExcelNumber $plate.comparisonRow "linha comparador '$($plate.name)'"
        if ($null -ne $directRow -and [int]$directRow -ge 6 -and [int]$directRow -le $lastComparisonRow) {
          $row = [int]$directRow
          Set-ExcelCellValue $comparisonSheet $row $col ([string]$plate.reference) "referencia comparador"
          Set-ExcelCellValue $comparisonSheet $row ($col + 1) $price "preco comparador"
          $family = Family-From-Reference $plate.reference $comparisonSheet.Cells.Item($row, 2).Value2
          if (-not [string]::IsNullOrWhiteSpace($family)) {
            Set-ExcelCellValue $comparisonSheet $row 1 $family "nome base comparador"
          }
          $updatedComparison += 1
          continue
        }
        for ($row = 6; $row -le $lastComparisonRow; $row += 1) {
          $rowKey = Comparison-Key $comparisonSheet.Cells.Item($row, 1).Value2 $comparisonSheet.Cells.Item($row, 2).Value2
          if ($rowKey -ne $targetKey) { continue }
          Set-ExcelCellValue $comparisonSheet $row $col ([string]$plate.reference) "referencia comparador"
          Set-ExcelCellValue $comparisonSheet $row ($col + 1) $price "preco comparador"
          $family = Family-From-Reference $plate.reference $comparisonSheet.Cells.Item($row, 2).Value2
          if (-not [string]::IsNullOrWhiteSpace($family)) {
            Set-ExcelCellValue $comparisonSheet $row 1 $family "nome base comparador"
          }
          $updatedComparison += 1
          break
        }
      }
      $comparisonWorkbook.Save()
    }
  }

  $excel.CalculateFullRebuild()
  if ($sheetWasProtected) { $sheet.Protect() }
  $workbook.Save()
  $workbook.Close($false)
  $workbook = $null

  [pscustomobject]@{
    ok = $true
    updated = $updated
    insertedPlates = $insertedPlates
    insertedPlateSuppliers = $insertedPlateSuppliers
    updatedPaint = $updatedPaint
    updatedEdges = $updatedEdges
    updatedDrawers = $updatedDrawers
    updatedSystems = $updatedSystems
    updatedExtras = $updatedExtras
    updatedComparison = $updatedComparison
    backup = $backupPath
  } | ConvertTo-Json -Compress
}
catch {
  if ($workbook -ne $null) { $workbook.Close($false) }
  if ($comparisonWorkbook -ne $null) { $comparisonWorkbook.Close($false) }
  $line = $_.InvocationInfo.ScriptLineNumber
  $message = $_.Exception.Message
  if ($line) { $message = "Linha ${line}: $message" }
  [pscustomobject]@{ ok = $false; error = $message } | ConvertTo-Json -Compress
  exit 1
}
finally {
  if ($sheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) }
  if ($paintSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($paintSheet) }
  if ($edgeSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($edgeSheet) }
  if ($drawerSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($drawerSheet) }
  if ($systemSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($systemSheet) }
  if ($baseWoodSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($baseWoodSheet) }
  if ($comparisonSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($comparisonSheet) }
  if ($comparisonWorkbook -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($comparisonWorkbook) }
  if ($workbook -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
  if ($excel -ne $null) {
    $excel.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
  Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object {
    $excelProcessIdsBefore -notcontains $_.Id -and [string]::IsNullOrWhiteSpace($_.MainWindowTitle)
  } | Stop-Process -Force -ErrorAction SilentlyContinue
}
