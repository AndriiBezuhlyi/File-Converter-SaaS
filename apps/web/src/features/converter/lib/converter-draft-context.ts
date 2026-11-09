import { createContext, useContext } from 'react';
import type { FileSelection } from './file-selection';

export interface ConverterDraft {
  selection: FileSelection | null;
  message: string;
  setSelection: (selection: FileSelection | null) => void;
  touch: () => void;
  isCurrent: (selection: FileSelection) => boolean;
  clear: () => void;
  bindJob: (selection: FileSelection, id: string) => void;
  completeJob: (id: string) => void;
}

export const ConverterDraftContext = createContext<ConverterDraft | null>(null);
export const useConverterDraft = () => useContext(ConverterDraftContext);
