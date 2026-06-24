export interface Participante {
  id: number;
  nome: string;
}

export interface DistribuicaoItem {
  nome: string;
  vagas: number;
}

export interface HistoricoItem {
  id: string;
  rodada: number;
  vagas: number;
  data: string;
  distribuicao: DistribuicaoItem[];
}

export interface FilaState {
  fila: Participante[];
  ultimaDistribuicao: DistribuicaoItem[];
  historico: HistoricoItem[];
}
