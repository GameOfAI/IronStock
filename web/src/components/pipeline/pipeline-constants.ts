/**
 * Shared constants for pipeline components (PR-F5e).
 * Kept in a separate non-component file to satisfy react-refresh/only-export-components.
 */

import {
  Server,
  Globe,
  Database,
  Key,
  Lock,
  Box,
  GitBranch,
  Package,
  Shield,
  Cpu,
  Cloud,
  FileCode,
} from 'lucide-react';
import type { RelationshipType } from '@/api/types';
import type * as React from 'react';

// --- Item type maps (mirrors server seed data) ───────────────────────────────

export const PIPELINE_TYPE_ICONS: Record<number, React.ElementType> = {
  1: Server,
  2: Globe,
  3: Database,
  4: Key,
  5: Lock,
  6: Box,
  7: GitBranch,
  8: Package,
  9: Shield,
  10: Cpu,
  11: Cloud,
  12: FileCode,
};

export const PIPELINE_TYPE_LABELS: Record<number, string> = {
  1: 'Sunucu',
  2: 'URL',
  3: 'Veritabanı',
  4: 'SSH Anh.',
  5: 'API Anh.',
  6: 'Genel',
  7: 'CI/CD',
  8: 'Registry',
  9: 'Güvenlik',
  10: 'CPU/HW',
  11: 'Bulut',
  12: 'Kaynak Kod',
};

// --- Relationship type display labels (Turkish) ──────────────────────────────

export const REL_LABELS: Record<RelationshipType, string> = {
  hosted_on: 'barındırılıyor',
  accessed_via: 'erişiliyor',
  part_of: 'parçası',
  related_to: 'ilişkili',
  depends_on: 'bağımlı',
  uses_tool: 'araç kullanır',
  builds_to: 'build eder',
  scans_with: 'tarar',
  deploys_to: 'deploy eder',
};
