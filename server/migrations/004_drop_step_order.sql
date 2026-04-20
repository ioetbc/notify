-- Migration 004: Remove step_order, rely on edge relationships

ALTER TABLE step DROP COLUMN step_order;
