import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  RotateCcw, 
  Sparkles, 
  History, 
  Plus, 
  Minus, 
  ChevronDown, 
  ChevronUp, 
  Check, 
  Edit3, 
  AlertCircle,
  X,
  Shuffle,
  ArrowRightLeft,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { Participante, DistribuicaoItem, HistoricoItem } from './types';
import { distribuirVagas, rotacionarFila } from './utils/distribution';

const FILA_INICIAL: Participante[] = [
  { id: 1, nome: "CARLA" },
  { id: 2, nome: "GEOVANE" },
  { id: 3, nome: "IRIS" },
  { id: 4, nome: "RAYSSA" },
  { id: 5, nome: "CLERIC" },
  { id: 6, nome: "CAMILLA" },
  { id: 7, nome: "ISABELLA" },
  { id: 8, nome: "TAINA" },
  { id: 9, nome: "TAIANE" }
];

const LOCAL_STORAGE_KEY = 'fila_vagas';

export default function App() {
  // State from LocalStorage or default (used as instant cache before Firebase loads)
  const [fila, setFila] = useState<Participante[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.fila)) return parsed.fila;
        } catch (e) {
          console.error("Erro ao ler fila inicial:", e);
        }
      }
    }
    return FILA_INICIAL;
  });

  const [ultimaDistribuicao, setUltimaDistribuicao] = useState<DistribuicaoItem[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.ultimaDistribuicao)) return parsed.ultimaDistribuicao;
        } catch (e) {
          console.error("Erro ao ler última distribuição:", e);
        }
      }
    }
    return [];
  });

  const [historico, setHistorico] = useState<HistoricoItem[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.historico)) return parsed.historico;
        } catch (e) {
          console.error("Erro ao ler histórico:", e);
        }
      }
    }
    return [];
  });

  // UI state
  const [vagasInput, setVagasInput] = useState<string>('');
  const [novoNome, setNovoNome] = useState<string>('');
  const [mensagem, setMensagem] = useState<{ tipo: 'sucesso' | 'erro' | 'info', texto: string } | null>(null);
  const [carregandoFirebase, setCarregandoFirebase] = useState<boolean>(true);
  const [nuvemSincronizada, setNuvemSincronizada] = useState<boolean>(false);
  
  // Dialog confirmation state to bypass window.confirm in iframe environments
  const [dialogoConfirmacao, setDialogoConfirmacao] = useState<{
    aberto: boolean;
    tipo: 'reiniciar' | 'esvaziar' | 'limpar-historico' | null;
    titulo: string;
    mensagem: string;
  }>({
    aberto: false,
    tipo: null,
    titulo: '',
    mensagem: ''
  });
  
  // Inline editing state
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editandoNome, setEditandoNome] = useState<string>('');

  // Expand state for history rounds
  const [historicoExpandido, setHistoricoExpandido] = useState<Record<string, boolean>>({});

  // Admin authentication states
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('vagas_isAdmin') === 'true';
    }
    return false;
  });
  const [senhaInput, setSenhaInput] = useState<string>('');
  const [loginModalAberto, setLoginModalAberto] = useState<boolean>(false);

  const handleLoginAdmin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (senhaInput === 'nova2026isp') {
      setIsAdmin(true);
      sessionStorage.setItem('vagas_isAdmin', 'true');
      setLoginModalAberto(false);
      setSenhaInput('');
      mostrarMensagem("Modo Administrador ativado!", "sucesso");
    } else {
      mostrarMensagem("Senha incorreta. Tente novamente.", "erro");
    }
  };

  const handleLogoutAdmin = () => {
    setIsAdmin(false);
    sessionStorage.removeItem('vagas_isAdmin');
    mostrarMensagem("Você saiu do modo Administrador.", "info");
  };

  // Real-time server sync via Firestore
  useEffect(() => {
    const docRef = doc(db, 'state', 'main');
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.fila)) setFila(data.fila);
        if (Array.isArray(data.ultimaDistribuicao)) setUltimaDistribuicao(data.ultimaDistribuicao);
        if (Array.isArray(data.historico)) setHistorico(data.historico);
        
        // Save to LocalStorage as cache
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
          fila: data.fila || [],
          ultimaDistribuicao: data.ultimaDistribuicao || [],
          historico: data.historico || []
        }));
      } else {
        // Initialize Firestore with current state (LocalStorage or defaults)
        setDoc(docRef, {
          fila,
          ultimaDistribuicao,
          historico
        }).catch(err => {
          handleFirestoreError(err, OperationType.WRITE, 'state/main');
        });
      }
      setCarregandoFirebase(false);
      setNuvemSincronizada(true);
    }, (error) => {
      setCarregandoFirebase(false);
      setNuvemSincronizada(false);
      handleFirestoreError(error, OperationType.GET, 'state/main');
    });

    return () => unsub();
  }, []);

  // Central function to update Firestore and local cache
  const atualizarBanco = async (
    novasFila: Participante[],
    novasDistribuicao: DistribuicaoItem[],
    novosHistorico: HistoricoItem[]
  ) => {
    // Optimistic local update
    setFila(novasFila);
    setUltimaDistribuicao(novasDistribuicao);
    setHistorico(novosHistorico);

    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      fila: novasFila,
      ultimaDistribuicao: novasDistribuicao,
      historico: novosHistorico
    }));

    try {
      const docRef = doc(db, 'state', 'main');
      await setDoc(docRef, {
        fila: novasFila,
        ultimaDistribuicao: novasDistribuicao,
        historico: novosHistorico
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'state/main');
    }
  };

  // Flash message helper
  const mostrarMensagem = (texto: string, tipo: 'sucesso' | 'erro' | 'info' = 'sucesso') => {
    setMensagem({ tipo, texto });
    setTimeout(() => {
      setMensagem(null);
    }, 4000);
  };

  // Add participant to the queue
  const handleAdicionarParticipante = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem adicionar participantes.", "erro");
      return;
    }
    const nomeLimpo = novoNome.trim().toUpperCase();
    if (!nomeLimpo) {
      mostrarMensagem("Por favor, digite um nome válido.", "erro");
      return;
    }

    // Check for duplicates
    if (fila.some(p => p.nome === nomeLimpo)) {
      mostrarMensagem(`"${nomeLimpo}" já está na fila!`, "erro");
      return;
    }

    // Generate unique ID
    const novoId = fila.length > 0 ? Math.max(...fila.map(p => p.id)) + 1 : 1;
    const novosParticipantes = [...fila, { id: novoId, nome: nomeLimpo }];
    atualizarBanco(novosParticipantes, ultimaDistribuicao, historico);
    setNovoNome('');
    mostrarMensagem(`"${nomeLimpo}" adicionado(a) à fila!`, "sucesso");
  };

  // Delete participant
  const handleExcluirParticipante = (id: number, nome: string) => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem remover participantes.", "erro");
      return;
    }
    const novaFila = fila.filter(p => p.id !== id);
    atualizarBanco(novaFila, ultimaDistribuicao, historico);
    mostrarMensagem(`"${nome}" removido(a) da fila.`, "info");
  };

  // Move participant up
  const handleSubirParticipante = (index: number) => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem reordenar a fila.", "erro");
      return;
    }
    if (index === 0) return;
    const novaFila = [...fila];
    const temp = novaFila[index];
    novaFila[index] = novaFila[index - 1];
    novaFila[index - 1] = temp;
    atualizarBanco(novaFila, ultimaDistribuicao, historico);
  };

  // Move participant down
  const handleDescerParticipante = (index: number) => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem reordenar a fila.", "erro");
      return;
    }
    if (index === fila.length - 1) return;
    const novaFila = [...fila];
    const temp = novaFila[index];
    novaFila[index] = novaFila[index + 1];
    novaFila[index + 1] = temp;
    atualizarBanco(novaFila, ultimaDistribuicao, historico);
  };

  // Start inline editing
  const iniciarEdicao = (id: number, nome: string) => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem editar participantes.", "erro");
      return;
    }
    setEditandoId(id);
    setEditandoNome(nome);
  };

  // Save inline editing
  const salvarEdicao = (id: number) => {
    if (!isAdmin) return;
    const nomeLimpo = editandoNome.trim().toUpperCase();
    if (!nomeLimpo) {
      mostrarMensagem("O nome não pode estar vazio.", "erro");
      return;
    }
    
    // Check duplication with other participants
    if (fila.some(p => p.id !== id && p.nome === nomeLimpo)) {
      mostrarMensagem(`"${nomeLimpo}" já está na fila!`, "erro");
      return;
    }

    const novaFila = fila.map(p => p.id === id ? { ...p, nome: nomeLimpo } : p);
    atualizarBanco(novaFila, ultimaDistribuicao, historico);
    setEditandoId(null);
    mostrarMensagem("Nome atualizado com sucesso!");
  };

  // Shuffle queue randomly
  const handleEmbaralharFila = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem embaralhar a fila.", "erro");
      return;
    }
    if (fila.length <= 1) return;
    const novaFila = [...fila].sort(() => Math.random() - 0.5);
    atualizarBanco(novaFila, ultimaDistribuicao, historico);
    mostrarMensagem("Fila embaralhada aleatoriamente!", "info");
  };

  // Distribute vacancies
  const handleDistribuir = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem distribuir vagas.", "erro");
      return;
    }
    const totalVagas = parseInt(vagasInput, 10);
    if (isNaN(totalVagas) || totalVagas <= 0) {
      mostrarMensagem("Digite uma quantidade de vagas válida e maior que zero.", "erro");
      return;
    }

    if (fila.length === 0) {
      mostrarMensagem("Não há participantes na fila para receber as vagas.", "erro");
      return;
    }

    // Distribute equally
    const resultado = distribuirVagas(fila, totalVagas);

    // Create history item
    const novaRodada = historico.length + 1;
    const timestamp = new Date();
    const dataFormatada = timestamp.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const novoHistoricoItem: HistoricoItem = {
      id: `${timestamp.getTime()}`,
      rodada: novaRodada,
      vagas: totalVagas,
      data: dataFormatada,
      distribuicao: resultado
    };

    const novoHistorico = [novoHistoricoItem, ...historico];
    const filaRotacionada = rotacionarFila(fila, totalVagas);

    atualizarBanco(filaRotacionada, resultado, novoHistorico);
    mostrarMensagem(`Distribuição de ${totalVagas} vagas realizada! A fila rodou para servir quem não pegou ainda.`, "sucesso");
  };

  // Pass vacancy from one participant to the next with 0 vacancies
  const handlePassarVaga = (indexDoador: number) => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem transferir vagas.", "erro");
      return;
    }
    if (ultimaDistribuicao[indexDoador].vagas <= 0) {
      mostrarMensagem("Este participante não possui vagas para passar.", "erro");
      return;
    }

    const n = ultimaDistribuicao.length;
    let indexReceptor = -1;

    // Search cyclically starting from the next participant
    for (let offset = 1; offset < n; offset++) {
      const idx = (indexDoador + offset) % n;
      if (ultimaDistribuicao[idx].vagas === 0) {
        indexReceptor = idx;
        break;
      }
    }

    if (indexReceptor === -1) {
      mostrarMensagem("Não há nenhum participante sem vagas para receber esta vaga.", "erro");
      return;
    }

    const doador = ultimaDistribuicao[indexDoador];
    const receptor = ultimaDistribuicao[indexReceptor];

    // Create updated distribution list
    const novaDistribuicao = ultimaDistribuicao.map((item, idx) => {
      if (idx === indexDoador) {
        return { ...item, vagas: item.vagas - 1 };
      }
      if (idx === indexReceptor) {
        return { ...item, vagas: item.vagas + 1 };
      }
      return item;
    });

    // Move the recipient (who is getting served/receiving the vacancy) to the end of the queue
    let novaFila = [...fila];
    const indexNoFila = fila.findIndex(p => p.nome === receptor.nome);
    if (indexNoFila !== -1) {
      const [removido] = novaFila.splice(indexNoFila, 1);
      novaFila.push(removido);
    }

    // Update latest history record if it matches this distribution
    let novoHistorico = [...historico];
    if (novoHistorico.length > 0) {
      novoHistorico[0] = {
        ...novoHistorico[0],
        distribuicao: novaDistribuicao
      };
    }

    atualizarBanco(novaFila, novaDistribuicao, novoHistorico);
    mostrarMensagem(`1 vaga passada de "${doador.nome}" para "${receptor.nome}". A fila rodou para servir quem não pegou ainda!`, "sucesso");
  };

  // Obter o acumulado de vagas pegas por cada pessoa ao longo do dia
  const obterVagasAcumuladas = () => {
    const acumulado: { [nome: string]: number } = {};

    // Primeiro, inicializa todos os participantes atuais da fila com 0
    fila.forEach(p => {
      acumulado[p.nome] = 0;
    });

    // Soma todas as vagas distribuídas em todas as rodadas do histórico
    historico.forEach(rodada => {
      rodada.distribuicao.forEach(item => {
        acumulado[item.nome] = (acumulado[item.nome] || 0) + item.vagas;
      });
    });

    // Converte para um array ordenado por mais vagas (decrescente)
    return Object.entries(acumulado)
      .map(([nome, vagas]) => ({ nome, vagas }))
      .sort((a, b) => b.vagas - a.vagas);
  };

  // Clear inputs and active distribution screen
  const handleLimpar = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem limpar a distribuição.", "erro");
      return;
    }
    setVagasInput('');
    atualizarBanco(fila, [], historico);
    mostrarMensagem("Distribuição limpa do painel.", "info");
  };

  // Confirm active action in modal
  const confirmarAcao = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem confirmar essa ação.", "erro");
      return;
    }
    const { tipo } = dialogoConfirmacao;
    if (tipo === 'reiniciar') {
      atualizarBanco(FILA_INICIAL, ultimaDistribuicao, historico);
      mostrarMensagem("Fila reiniciada com os participantes padrão.", "sucesso");
    } else if (tipo === 'esvaziar') {
      atualizarBanco([], [], historico);
      mostrarMensagem("Fila de participantes esvaziada.", "info");
    } else if (tipo === 'limpar-historico') {
      atualizarBanco(fila, ultimaDistribuicao, []);
      mostrarMensagem("Histórico apagado com sucesso.", "info");
    }
    setDialogoConfirmacao({ aberto: false, tipo: null, titulo: '', mensagem: '' });
  };

  // Reset queue to initial 9 people
  const handleReiniciarFila = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem reiniciar os participantes.", "erro");
      return;
    }
    setDialogoConfirmacao({
      aberto: true,
      tipo: 'reiniciar',
      titulo: 'REINICIAR PARTICIPANTES',
      mensagem: 'Deseja realmente redefinir a fila para os participantes padrão? Isso manterá o histórico de rodadas intacto.'
    });
  };

  // Completely clear queue
  const handleEsvaziarFila = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem esvaziar a fila.", "erro");
      return;
    }
    setDialogoConfirmacao({
      aberto: true,
      tipo: 'esvaziar',
      titulo: 'ESVAZIAR FILA',
      mensagem: 'Deseja realmente esvaziar toda a fila de participantes?'
    });
  };

  // Clear history list
  const handleLimparHistorico = () => {
    if (!isAdmin) {
      mostrarMensagem("Acesso negado. Apenas administradores podem apagar o histórico.", "erro");
      return;
    }
    setDialogoConfirmacao({
      aberto: true,
      tipo: 'limpar-historico',
      titulo: 'APAGAR HISTÓRICO',
      mensagem: 'Deseja apagar todo o histórico de rodadas? Esta ação é irreversível.'
    });
  };

  // Toggle history details visibility
  const toggleHistoricoItem = (id: string) => {
    setHistoricoExpandido(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col antialiased font-sans p-4 sm:p-6 md:p-10">
      {/* Top Navigation / Header Section */}
      <header className="max-w-7xl w-full mx-auto flex flex-col md:flex-row justify-between items-start md:items-end border-b-4 border-slate-900 pb-6 mb-10 gap-4" id="app-header">
        <div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter uppercase text-slate-900" id="header-title">Fila de Vagas</h1>
          <p className="text-slate-500 font-medium mt-1 uppercase tracking-widest text-xs sm:text-sm">Gestão de Distribuição Equitativa • Servidor Firestore</p>
        </div>
        <div className="text-left md:text-right flex md:flex-col items-center md:items-end justify-between w-full md:w-auto border-t md:border-t-0 pt-3 md:pt-0 border-slate-200">
          <div>
            <span className="block text-[10px] md:text-xs font-bold text-slate-400 uppercase">Status do Sistema</span>
            {carregandoFirebase ? (
              <span className="text-amber-600 font-bold uppercase tracking-tight text-sm md:text-base flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block animate-bounce"></span>
                Conectando...
              </span>
            ) : nuvemSincronizada ? (
              <span className="text-emerald-600 font-bold uppercase tracking-tight text-sm md:text-base flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                Servidor Sincronizado
              </span>
            ) : (
              <span className="text-rose-600 font-bold uppercase tracking-tight text-sm md:text-base flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                Modo Offline
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1 md:justify-end">
            {nuvemSincronizada ? (
              <>
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold bg-emerald-100 border border-slate-900 text-emerald-950 uppercase animate-pulse">
                  Online
                </span>
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold bg-blue-100 border border-slate-900 text-blue-950 uppercase">
                  Compartilhado
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold bg-slate-200 border border-slate-900 text-slate-800 uppercase">
                  Offline
                </span>
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold bg-indigo-100 border border-slate-900 text-indigo-950 uppercase">
                  Cache Local
                </span>
              </>
            )}

            {isAdmin ? (
              <button
                onClick={handleLogoutAdmin}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-amber-100 border border-amber-500 text-amber-900 hover:bg-amber-200 uppercase transition-all rounded-xs cursor-pointer"
                title="Sair do modo administrador"
              >
                <span>🔑 ADM ATIVO (SAIR)</span>
              </button>
            ) : (
              <button
                onClick={() => setLoginModalAberto(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-slate-100 border border-slate-400 text-slate-700 hover:bg-slate-200 uppercase transition-all rounded-xs cursor-pointer"
                title="Acessar como administrador"
              >
                <span>🔐 ENTRAR COMO ADM</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto space-y-10">
        
        {/* Flash Message Notification */}
        <AnimatePresence>
          {mensagem && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-4 border-2 border-slate-900 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] flex items-center justify-between ${
                mensagem.tipo === 'sucesso' 
                  ? 'bg-emerald-100 text-emerald-950' 
                  : mensagem.tipo === 'erro' 
                    ? 'bg-rose-100 text-rose-950' 
                    : 'bg-indigo-100 text-indigo-950'
              }`}
              id="app-alert"
            >
              <div className="flex items-center space-x-3">
                {mensagem.tipo === 'erro' ? <AlertCircle className="h-5 w-5 shrink-0 text-slate-950" /> : <Sparkles className="h-5 w-5 shrink-0 text-slate-950" />}
                <p className="text-sm font-bold uppercase tracking-tight">{mensagem.texto}</p>
              </div>
              <button onClick={() => setMensagem(null)} className="p-1 hover:bg-black/10 border border-transparent hover:border-slate-950 rounded-xs transition-colors">
                <X className="h-4 w-4 text-slate-950" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* View-Only Mode Banner */}
        {!isAdmin && (
          <div className="bg-amber-50 border-2 border-slate-900 p-4 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] flex flex-col sm:flex-row items-center justify-between gap-3" id="view-only-banner">
            <div className="flex items-center space-x-3 text-amber-950">
              <Lock className="h-5 w-5 shrink-0 text-slate-900 animate-pulse" />
              <div>
                <p className="text-xs font-black uppercase tracking-wide">Modo de Visualização Ativo</p>
                <p className="text-[11px] font-medium text-slate-600 uppercase tracking-tight">Você pode ver a fila em tempo real, mas somente o Administrador pode realizar alterações.</p>
              </div>
            </div>
            <button
              onClick={() => setLoginModalAberto(true)}
              className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider px-4 py-2 border-2 border-slate-900 transition-all shrink-0 active:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(15,23,42,1)]"
            >
              Entrar como ADM
            </button>
          </div>
        )}

        {/* Dashboard Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          
          {/* LEFT PANEL: Queue Control (span 4/12 matches Geometric Balance mockup) */}
          <section className="lg:col-span-4 flex flex-col space-y-4" id="panel-queue">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold uppercase flex items-center text-slate-900">
                <span className="w-2.5 h-6 bg-slate-900 mr-2 inline-block"></span>
                Fila Atual
              </h2>
              <span className="bg-slate-200 border border-slate-900 px-3 py-1 text-xs font-black rounded-full text-slate-900 uppercase">
                {fila.length} {fila.length === 1 ? 'Integrante' : 'Integrantes'}
              </span>
            </div>

            <div className="bg-white border-2 border-slate-900 shadow-[6px_6px_0px_0px_rgba(15,23,42,1)] flex flex-col">
              {/* Header inside queue card with controls */}
              <div className="p-4 border-b-2 border-slate-900 bg-slate-100 flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-600 tracking-wider">Membros da Fila</span>
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={handleEmbaralharFila}
                    title={isAdmin ? "Embaralhar fila" : "Apenas para Administrador"}
                    disabled={fila.length <= 1 || !isAdmin}
                    className="p-1.5 text-slate-700 hover:text-slate-950 border border-slate-300 hover:border-slate-900 bg-white hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleEsvaziarFila}
                    title={isAdmin ? "Limpar toda a fila" : "Apenas para Administrador"}
                    disabled={fila.length === 0 || !isAdmin}
                    className="p-1.5 text-rose-700 hover:text-rose-900 border border-slate-300 hover:border-rose-900 bg-white hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Quick Add Form */}
              <form onSubmit={handleAdicionarParticipante} className="p-4 bg-slate-50 border-b-2 border-slate-900 flex gap-2">
                <input
                  type="text"
                  placeholder={isAdmin ? "DIGITE NOME DO PARTICIPANTE..." : "MODO DE VISUALIZAÇÃO ATIVO"}
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  disabled={!isAdmin}
                  className="flex-1 bg-white border-2 border-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide focus:outline-hidden focus:bg-amber-50/20 transition-all placeholder:text-slate-400 placeholder:normal-case disabled:opacity-50 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  id="add-participant-input"
                />
                <button
                  type="submit"
                  disabled={!isAdmin}
                  className="bg-slate-900 hover:bg-slate-800 text-white p-2 px-4 border-2 border-slate-900 font-black text-xs uppercase tracking-wider flex items-center space-x-1 transition-all active:translate-y-0.5 hover:shadow-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  id="add-participant-btn"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>ADD</span>
                </button>
              </form>

              {/* Participant List */}
              <div className="max-h-[460px] overflow-y-auto divide-y-2 divide-slate-100" id="queue-list-container">
                {fila.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Users className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">A fila está vazia</p>
                    <p className="text-[11px] text-slate-400 mt-1">Adicione pessoas acima ou restaure o padrão.</p>
                  </div>
                ) : (
                  fila.map((p, index) => (
                    <div 
                      key={p.id}
                      className="group flex items-center justify-between p-3.5 bg-white hover:bg-slate-50 transition-colors"
                      id={`participant-item-${p.id}`}
                    >
                      <div className="flex items-center space-x-3 mr-2 min-w-0 flex-1">
                        {/* Position Indicator Badge */}
                        <span className="w-6 h-6 shrink-0 bg-slate-100 border border-slate-300 text-slate-500 font-mono font-bold text-xs flex items-center justify-center">
                          {String(index + 1).padStart(2, '0')}
                        </span>

                        {/* Name display or editor */}
                        {editandoId === p.id ? (
                          <div className="flex items-center space-x-2 flex-1">
                            <input
                              type="text"
                              value={editandoNome}
                              onChange={(e) => setEditandoNome(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && salvarEdicao(p.id)}
                              className="w-full bg-white border-2 border-slate-900 px-2 py-0.5 text-xs font-black uppercase text-indigo-700"
                              autoFocus
                            />
                            <button 
                              type="button" 
                              onClick={() => salvarEdicao(p.id)}
                              className="p-1 bg-emerald-100 border border-emerald-600 text-emerald-800 transition-colors"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button 
                              type="button" 
                              onClick={() => setEditandoId(null)}
                              className="p-1 bg-slate-100 border border-slate-400 text-slate-600 transition-colors"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="font-black text-slate-900 tracking-tight text-sm uppercase truncate">
                              {p.nome}
                            </span>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => iniciarEdicao(p.id, p.nome)}
                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-900 transition-all cursor-pointer"
                                title="Editar nome"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Controls - Only visible for admin */}
                      {isAdmin && (
                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSubirParticipante(index)}
                            disabled={index === 0}
                            className="p-1 text-slate-500 hover:text-slate-950 hover:bg-slate-100 border border-transparent hover:border-slate-300 disabled:opacity-20 transition-all cursor-pointer"
                            title="Subir posição"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDescerParticipante(index)}
                            disabled={index === fila.length - 1}
                            className="p-1 text-slate-500 hover:text-slate-950 hover:bg-slate-100 border border-transparent hover:border-slate-300 disabled:opacity-20 transition-all cursor-pointer"
                            title="Descer posição"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExcluirParticipante(p.id, p.nome)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer"
                            title="Remover"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Reset Pattern queue button - Only visible for admin */}
              {isAdmin && (
                <div className="p-3 bg-slate-100 border-t-2 border-slate-900 flex justify-end">
                  <button
                    type="button"
                    onClick={handleReiniciarFila}
                    className="w-full text-center text-xs font-bold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-50 py-2 border-2 border-slate-900 transition-all active:translate-y-0.5 cursor-pointer"
                    id="btn-reiniciar-fila-footer"
                  >
                    REINICIAR PARTICIPANTES PADRÃO
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* CENTER PANEL: Vacancy Distribution Control & Resumo (span 4/12 matches layout) */}
          <section className="lg:col-span-4 flex flex-col space-y-8">
            
            {/* Vacancy Card */}
            <div>
              <h2 className="text-xl font-bold uppercase flex items-center mb-4 text-slate-900">
                <span className="w-2.5 h-6 bg-blue-600 mr-2 inline-block"></span>
                Distribuição
              </h2>
              
              <div className="bg-white border-2 border-slate-900 p-6 shadow-[6px_6px_0px_0px_rgba(37,99,235,1)]" id="panel-distribute-input">
                <label htmlFor="vagas-input" className="block text-xs font-black uppercase text-slate-500 mb-2">
                  Quantidade de Vagas
                </label>
                
                {/* Custom Big Number input */}
                <div className="relative mb-4">
                  <input
                    type="number"
                    id="vagas-input"
                    min="1"
                    placeholder="0"
                    value={vagasInput}
                    onChange={(e) => setVagasInput(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full text-4xl font-black p-4 bg-slate-100 border-2 border-slate-900 text-slate-900 focus:outline-hidden focus:bg-white transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        const val = parseInt(vagasInput, 10) || 0;
                        setVagasInput(String(val + 1));
                      }}
                      disabled={!isAdmin}
                      className="p-1 hover:bg-slate-200 border border-slate-300 text-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const val = parseInt(vagasInput, 10) || 0;
                        setVagasInput(String(Math.max(1, val - 1)));
                      }}
                      disabled={!isAdmin}
                      className="p-1 hover:bg-slate-200 border border-slate-300 text-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Quick helpers preset values */}
                <div className="flex gap-1.5 mb-5">
                  <button
                    type="button"
                    onClick={() => setVagasInput('5')}
                    disabled={!isAdmin}
                    className="flex-1 text-center py-1 bg-slate-100 hover:bg-slate-200 text-xs font-mono font-black border border-slate-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    5 VAGAS
                  </button>
                  <button
                    type="button"
                    onClick={() => setVagasInput('12')}
                    disabled={!isAdmin}
                    className="flex-1 text-center py-1 bg-slate-100 hover:bg-slate-200 text-xs font-mono font-black border border-slate-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    12 VAGAS
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const size = fila.length;
                      if (size > 0) setVagasInput(String(size));
                    }}
                    disabled={fila.length === 0 || !isAdmin}
                    className="text-center px-2 py-1 bg-slate-100 hover:bg-slate-200 text-xs font-bold border border-slate-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Definir igual ao tamanho da fila"
                  >
                    QTD FILA ({fila.length})
                  </button>
                </div>

                {/* Queue Math Rule Info Banner */}
                <div className="bg-amber-50 border-2 border-slate-900 p-3 mb-5 shadow-[2px_2px_0px_0px_rgba(15,23,42,1)]">
                  <p className="text-[11px] text-slate-800 font-bold uppercase tracking-tight leading-relaxed">
                    🔄 ROTATIVIDADE AUTOMÁTICA ATIVA:
                  </p>
                  <p className="text-[10px] text-slate-600 font-mono uppercase tracking-tight mt-0.5 leading-normal">
                    Ao distribuir, os participantes que recebem vagas vão automaticamente para o fim da fila, garantindo que as próximas vagas sirvam primeiro quem ainda não pegou.
                  </p>
                </div>

                {/* Main Action Buttons */}
                <button
                  type="button"
                  onClick={handleDistribuir}
                  disabled={!isAdmin}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black text-xl py-4 border-2 border-slate-900 active:translate-x-0.5 active:translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] transition-all uppercase tracking-wide flex items-center justify-center space-x-2 disabled:opacity-50 disabled:bg-slate-400 disabled:border-slate-400 disabled:cursor-not-allowed disabled:hover:shadow-none"
                  id="btn-distribuir"
                >
                  <Sparkles className="h-5 w-5" />
                  <span>DISTRIBUIR</span>
                </button>
                
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <button
                    type="button"
                    onClick={handleLimpar}
                    disabled={!isAdmin}
                    className="bg-slate-100 hover:bg-slate-200 font-bold py-2 border-2 border-slate-900 text-xs uppercase tracking-wider text-slate-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    id="btn-limpar"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={handleReiniciarFila}
                    disabled={!isAdmin}
                    className="bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold py-2 border-2 border-rose-600 text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    id="btn-reiniciar-fila"
                  >
                    Reset Fila
                  </button>
                </div>
              </div>
            </div>

            {/* Resumo/Summary Box */}
            <div className="flex-1 flex flex-col">
              <h2 className="text-xl font-bold uppercase flex items-center mb-4 text-slate-900">
                <span className="w-2.5 h-6 bg-slate-400 mr-2 inline-block"></span>
                Resumo Atual
              </h2>
              
              <div className="bg-slate-900 text-white p-6 shadow-[6px_6px_0px_0px_rgba(15,23,42,1)] flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex justify-between border-b border-slate-700 pb-2">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total de Integrantes</span>
                    <span className="font-mono font-bold text-sm">{fila.length}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-700 pb-2">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Vagas Solicitadas</span>
                    <span className="font-mono font-bold text-sm text-yellow-400">{vagasInput || '0'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-700 pb-2">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Vagas Mínimas p/ Pessoa</span>
                    <span className="font-mono font-bold text-sm">
                      {fila.length > 0 && vagasInput ? Math.floor(Number(vagasInput) / fila.length) : '0'}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-700 pb-2">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Integrantes c/ Vaga Extra (+1)</span>
                    <span className="font-mono font-bold text-sm">
                      {fila.length > 0 && vagasInput ? (Number(vagasInput) % fila.length) : '0'}
                    </span>
                  </div>
                </div>

                <div className="mt-6 p-3.5 bg-blue-900/30 border border-blue-500 text-blue-300 text-xs tracking-tight">
                  {fila.length > 0 && vagasInput && Number(vagasInput) > 0 ? (
                    `Distribuição garantida: Cada integrante na fila receberá no mínimo ${Math.floor(Number(vagasInput) / fila.length)} vaga(s), com os primeiros ${Number(vagasInput) % fila.length} recebendo 1 vaga extra.`
                  ) : (
                    "Digite a quantidade de vagas acima para simular a distribuição matemática equitativa com base na ordem da fila."
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT PANEL: History and active results (span 4/12 matches layout) */}
          <section className="lg:col-span-4 flex flex-col space-y-8">
            
            {/* DISTRIBUTION RESULTS PANEL */}
            <AnimatePresence mode="wait">
              {ultimaDistribuicao.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.25 }}
                  className="bg-white border-2 border-emerald-500 p-6 shadow-[6px_6px_0px_0px_rgba(16,185,129,1)] space-y-4"
                  id="panel-results"
                >
                  <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black uppercase text-emerald-800 tracking-wider">Resultado Ativo</h3>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Matriz de Distribuição</p>
                    </div>
                    <span className="bg-emerald-100 text-emerald-800 text-xs font-black px-2 py-0.5 border border-emerald-600">
                      {ultimaDistribuicao.reduce((acc, curr) => acc + curr.vagas, 0)} VAGAS
                    </span>
                  </div>

                  {/* Result List */}
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1" id="results-grid">
                    {ultimaDistribuicao.map((item, index) => {
                      const temVaga = item.vagas > 0;
                      return (
                        <div 
                          key={`${item.nome}-${index}`}
                          className={`flex items-center justify-between p-2 text-xs border ${
                            temVaga 
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold' 
                              : 'bg-slate-50 border-slate-200 text-slate-400'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                            <span className="uppercase font-bold tracking-wider truncate">{item.nome}</span>
                            {temVaga && isAdmin && (
                              <button
                                type="button"
                                onClick={() => handlePassarVaga(index)}
                                className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border-2 border-blue-600 font-black text-[9px] uppercase tracking-wider transition-all active:translate-y-0.5 flex items-center gap-1 shrink-0 cursor-pointer"
                                title="Passar 1 vaga para o próximo sem vagas"
                              >
                                <ArrowRightLeft className="h-2.5 w-2.5" />
                                <span>Passar</span>
                              </button>
                            )}
                          </div>
                          
                          <span className={`font-mono font-black px-2 py-0.5 text-xs shrink-0 ${
                            temVaga ? 'bg-emerald-200 border border-emerald-500 text-emerald-900' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {item.vagas} VG
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* LOG DE VAGAS ACUMULADAS NO DIA */}
            {historico.length > 0 && (
              <div className="bg-slate-50 border-2 border-slate-900 p-5 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] space-y-3">
                <div className="border-b border-slate-200 pb-2 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black uppercase text-slate-900 tracking-wider flex items-center gap-1.5">
                      <span className="w-2.5 h-5 bg-blue-600 inline-block"></span>
                      Vagas do Dia (Log)
                    </h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Total acumulado por pessoa</p>
                  </div>
                  <span className="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-0.5 border border-blue-600">
                    TOTAL: {historico.reduce((acc, curr) => acc + curr.vagas, 0)} VG
                  </span>
                </div>

                <div className="grid grid-cols-1 divide-y divide-slate-200 max-h-[220px] overflow-y-auto pr-1">
                  {obterVagasAcumuladas().map((item, index) => {
                    const temVagas = item.vagas > 0;
                    return (
                      <div key={`${item.nome}-${index}`} className="flex items-center justify-between py-2 text-xs">
                        <span className={`uppercase tracking-wide truncate ${temVagas ? 'font-bold text-slate-900' : 'text-slate-400'}`}>
                          {item.nome}
                        </span>
                        <span className={`font-mono font-black px-2 py-0.5 text-[10px] ${
                          temVagas ? 'bg-blue-100 border border-blue-400 text-blue-900' : 'bg-slate-100 border border-slate-200 text-slate-400'
                        }`}>
                          {item.vagas} Vagas
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* HISTORIC ROUNDS SECTION */}
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold uppercase flex items-center text-slate-900">
                  <span className="w-2.5 h-6 bg-amber-400 mr-2 inline-block"></span>
                  Histórico
                </h2>
                {historico.length > 0 && isAdmin && (
                  <button
                    type="button"
                    onClick={handleLimparHistorico}
                    className="text-[10px] font-black text-rose-700 hover:text-rose-900 px-2 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-300 uppercase transition-all cursor-pointer"
                    id="btn-limpar-historico"
                  >
                    Apagar Tudo
                  </button>
                )}
              </div>

              {historico.length === 0 ? (
                <div className="bg-white border-2 border-slate-200 p-8 text-center text-slate-400">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-bold uppercase tracking-wider">Nenhuma rodada efetuada</p>
                  <p className="text-[10px] text-slate-400 mt-1">Os dados de distribuição aparecerão arquivados aqui.</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1" id="history-rounds-list">
                  {historico.map((rodada) => {
                    const isExpandido = !!historicoExpandido[rodada.id];
                    return (
                      <div 
                        key={rodada.id}
                        className="border-2 border-slate-900 bg-white p-4 relative shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] transition-all"
                        id={`history-round-card-${rodada.id}`}
                      >
                        {/* Summary Line */}
                        <div 
                          onClick={() => toggleHistoricoItem(rodada.id)}
                          className="cursor-pointer select-none"
                        >
                          <div className="absolute top-0 right-0 bg-slate-900 text-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">
                            RODADA #{String(rodada.rodada).padStart(2, '0')}
                          </div>
                          
                          <p className="font-black text-xl text-slate-900 tracking-tight">{rodada.vagas} VAGAS</p>
                          <p className="text-[10px] text-slate-400 font-mono font-medium mt-0.5">{rodada.data}</p>
                          
                          {/* visual progress bars for vacancies distributed */}
                          <div className="mt-3 flex gap-1 items-center justify-between">
                            <div className="flex gap-1">
                              {rodada.distribuicao.slice(0, 8).map((item, idx) => (
                                <div 
                                  key={idx} 
                                  className={`h-1.5 w-3.5 ${item.vagas > 0 ? 'bg-blue-600' : 'bg-slate-200'}`}
                                  title={`${item.nome}: ${item.vagas}`}
                                ></div>
                              ))}
                              {rodada.distribuicao.length > 8 && (
                                <span className="text-[9px] text-slate-400 font-bold ml-1">+{rodada.distribuicao.length - 8}</span>
                              )}
                            </div>
                            
                            <span className="text-[10px] font-bold text-slate-600 flex items-center">
                              {isExpandido ? 'Ocultar' : 'Ver'}
                              {isExpandido ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
                            </span>
                          </div>
                        </div>

                        {/* Detailed distribution list */}
                        <AnimatePresence initial={false}>
                          {isExpandido && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden mt-3 pt-3 border-t border-dashed border-slate-300"
                            >
                              <div className="grid grid-cols-2 gap-1 bg-slate-50 p-2.5 border border-slate-200">
                                {rodada.distribuicao.map((item, idx) => (
                                  <div 
                                    key={idx}
                                    className="flex justify-between items-center text-[10px] py-0.5 border-b border-slate-100"
                                  >
                                    <span className="font-black text-slate-700 uppercase truncate max-w-[70px]">{item.nome}</span>
                                    <span className={`font-mono font-bold px-1 rounded-xs text-[10px] ${
                                      item.vagas > 0 ? 'bg-blue-100 text-blue-800 font-black' : 'text-slate-400'
                                    }`}>
                                      {item.vagas}vg
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Safety notice info box */}
              <div className="bg-slate-200 p-4 border-l-4 border-slate-900 mt-2">
                <p className="text-xs font-bold leading-tight uppercase text-slate-900">Backup de Segurança</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Os dados de fila e histórico são gravados localmente neste navegador. Limpar o cache ou trocar de navegador redefinirá o estado.
                </p>
              </div>
            </div>

          </section>

        </div>
      </main>

      {/* Elegant Footer */}
      <footer className="max-w-7xl w-full mx-auto bg-slate-900 text-white p-6 mt-16 border-t-4 border-blue-600 flex flex-col md:flex-row justify-between items-center gap-4 text-xs">
        <div className="flex flex-col gap-1 text-center md:text-left">
          <p className="font-black tracking-tight uppercase">© 2026 FILA DE VAGAS • EQUIDADE & TRANSPARÊNCIA</p>
          <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Direitos do projeto atribuídos a Luiz Henrique</p>
        </div>
        <p className="text-slate-400 font-mono">SINCRONIZADO AUTOMATICAMENTE EM TEMPO REAL COM O SERVIDOR FIRESTORE</p>
      </footer>

      {/* Neo-Brutalist Custom Confirmation Modal */}
      <AnimatePresence>
        {dialogoConfirmacao.aberto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-xs" id="custom-confirm-modal">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white border-4 border-slate-900 p-6 max-w-md w-full shadow-[8px_8px_0px_0px_rgba(15,23,42,1)]"
            >
              <h3 className="text-xl font-black uppercase text-slate-900 tracking-tight mb-2 border-b-2 border-slate-900 pb-2">
                {dialogoConfirmacao.titulo}
              </h3>
              <p className="text-slate-600 font-bold uppercase tracking-tight text-xs mb-6 leading-relaxed">
                {dialogoConfirmacao.mensagem}
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setDialogoConfirmacao(prev => ({ ...prev, aberto: false }))}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold uppercase text-xs tracking-wider px-4 py-2.5 border-2 border-slate-900 transition-all active:translate-y-0.5 cursor-pointer"
                  id="confirm-modal-cancel-btn"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarAcao}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-xs tracking-wider px-4 py-2.5 border-2 border-slate-900 transition-all active:translate-y-0.5 hover:shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer"
                  id="confirm-modal-confirm-btn"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Login Dialog */}
      <AnimatePresence>
        {loginModalAberto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLoginModalAberto(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            
            {/* Modal Box */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative bg-white border-4 border-slate-900 p-6 max-w-md w-full shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] space-y-4"
            >
              <div className="flex items-start justify-between border-b-2 border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                    <Lock className="h-5 w-5 text-slate-900" />
                    Acesso Administrador
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Digite a senha para habilitar edições</p>
                </div>
                <button 
                  onClick={() => {
                    setLoginModalAberto(false);
                    setSenhaInput('');
                  }} 
                  className="p-1 hover:bg-slate-100 border border-transparent hover:border-slate-300 rounded-xs transition-colors"
                >
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handleLoginAdmin} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Senha de Acesso</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={senhaInput}
                    onChange={(e) => setSenhaInput(e.target.value)}
                    className="w-full bg-slate-100 border-2 border-slate-900 p-3 text-sm font-bold focus:outline-hidden focus:bg-white transition-all"
                    autoFocus
                  />
                </div>

                <div className="flex gap-3 justify-end pt-2 border-t-2 border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setLoginModalAberto(false);
                      setSenhaInput('');
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border-2 border-slate-900 text-xs font-black uppercase tracking-wider transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white border-2 border-slate-900 text-xs font-black uppercase tracking-wider transition-all active:translate-y-0.5"
                  >
                    Confirmar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
