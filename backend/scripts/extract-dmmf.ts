/**
 * DMMF Extraction Script
 * Extracts Prisma Data Model Meta Format (DMMF) from schema.prisma
 * and saves it as JSON for Python client code generation
 *
 * Usage: npx tsx scripts/extract-dmmf.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { getDMMF } = require('@prisma/internals')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface DMMFModel {
  name: string
  dbName: string | null
  fields: DMMFField[]
  primaryKey: { fields: string[] } | null
  uniqueFields: string[][]
  uniqueIndexes: { fields: string[] }[]
  isGenerated: boolean
}

interface DMMFField {
  name: string
  kind: 'scalar' | 'object' | 'enum' | 'unsupported'
  isList: boolean
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  isReadOnly: boolean
  type: string
  hasDefaultValue: boolean
  default?: unknown
  relationName?: string
  relationFromFields?: string[]
  relationToFields?: string[]
  isGenerated: boolean
  isUpdatedAt: boolean
}

interface DMMFEnum {
  name: string
  values: { name: string; dbName: string | null }[]
  dbName: string | null
}

interface ExtractedDMMF {
  models: DMMFModel[]
  enums: DMMFEnum[]
  generatedAt: string
  schemaPath: string
}

async function extractDMMF(): Promise<void> {
  const schemaPath = path.join(__dirname, '../prisma/schema.prisma')
  const outputPath = path.join(__dirname, '../prisma/dmmf.json')

  console.log('📖 Reading schema from:', schemaPath)

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`)
  }

  const datamodel = fs.readFileSync(schemaPath, 'utf-8')

  console.log('🔄 Parsing schema with Prisma DMMF...')

  const dmmf = await getDMMF({ datamodel })

  const extracted: ExtractedDMMF = {
    models: dmmf.datamodel.models.map((model) => ({
      name: model.name,
      dbName: model.dbName,
      fields: model.fields.map((field) => ({
        name: field.name,
        kind: field.kind,
        isList: field.isList,
        isRequired: field.isRequired,
        isUnique: field.isUnique,
        isId: field.isId,
        isReadOnly: field.isReadOnly,
        type: field.type,
        hasDefaultValue: field.hasDefaultValue,
        default: field.default,
        relationName: field.relationName,
        relationFromFields: field.relationFromFields,
        relationToFields: field.relationToFields,
        isGenerated: field.isGenerated,
        isUpdatedAt: field.isUpdatedAt,
      })),
      primaryKey: model.primaryKey,
      uniqueFields: model.uniqueFields,
      uniqueIndexes: model.uniqueIndexes,
      isGenerated: model.isGenerated,
    })),
    enums: dmmf.datamodel.enums.map((e) => ({
      name: e.name,
      values: e.values.map((v) => ({
        name: v.name,
        dbName: v.dbName,
      })),
      dbName: e.dbName,
    })),
    generatedAt: new Date().toISOString(),
    schemaPath: schemaPath,
  }

  fs.writeFileSync(outputPath, JSON.stringify(extracted, null, 2))

  console.log('✅ DMMF extracted successfully!')
  console.log(`   📊 Models: ${extracted.models.length}`)
  console.log(`   📋 Enums: ${extracted.enums.length}`)
  console.log(`   📁 Output: ${outputPath}`)

  // Print model names for reference
  console.log('\n📝 Models:')
  extracted.models.forEach((m) => {
    const scalarFields = m.fields.filter((f) => f.kind === 'scalar').length
    const relationFields = m.fields.filter((f) => f.kind === 'object').length
    console.log(`   - ${m.name} (${scalarFields} fields, ${relationFields} relations)`)
  })
}

extractDMMF().catch((error) => {
  console.error('❌ Failed to extract DMMF:', error)
  process.exit(1)
})
