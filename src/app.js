const express = require('express');
const cors = require('cors');
const dados = require('./data/mock');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors());
app.use(express.json());

const CORES = {
    primaria: '#BCD652',     // Verde limão para a barra superior
    secundaria: '#008060',   // Verde escuro para background
    fundo: '#008060',        // Verde escuro para background
    texto: '#FFFFFF',        // Texto branco para melhor contraste com fundo verde
    textoClaro: '#000000',   // Texto preto para área clara
    borda: '#BCD652'         // Verde limão para bordas
};

// Atribuir créditos a beneficiários
app.post('/lote-creditos', async (req, res) => {
    const { creditos } = req.body;

    if (!creditos || !Array.isArray(creditos) || creditos.length === 0) {
        return res.status(400).json({ 
            mensagem: "É necessário enviar pelo menos um crédito" 
        });
    }

    const dataCredito = creditos[0].dataCredito;
    const dataAtual = new Date();
    const dataCreditar = new Date(dataCredito);
    
    if (dataCreditar < dataAtual) {
        return res.status(400).json({ 
            mensagem: "A data de crédito não pode ser anterior à data atual" 
        });
    }

    const novoLote = {
        id: uuidv4(),
        data: dataCredito,
        status: "PENDENTE",
        creditosIds: [],
        valorTotal: 0
    };

    const creditosProcessados = [];
    
    for (const credito of creditos) {
        const beneficiario = dados.beneficiarios.find(b => b.id === credito.beneficiarioId);
        
        if (!beneficiario) {
            return res.status(400).json({ 
                mensagem: `Beneficiário ${credito.beneficiarioId} não encontrado` 
            });
        }

        if (!credito.valor || credito.valor <= 0) {
            return res.status(400).json({ 
                mensagem: `Valor inválido para o beneficiário ${beneficiario.nomeCompleto}` 
            });
        }

        const novoCredito = {
            id: beneficiario.creditos.length + 1,
            valor: parseFloat(credito.valor),
            dataCredito,
            status: "PENDENTE",
            loteId: novoLote.id
        };

        beneficiario.creditos.push(novoCredito);
        novoLote.creditosIds.push(novoCredito.id);
        novoLote.valorTotal += novoCredito.valor;
        
        creditosProcessados.push({
            beneficiarioId: beneficiario.id,
            nomeCompleto: beneficiario.nomeCompleto,
            cpf: beneficiario.cpf,
            credito: novoCredito
        });
    }

    // Gerar informações de pagamento
    const dadosPagamento = {
        pix: gerarPix(novoLote.valorTotal),
        boleto: gerarLinkBoleto(novoLote.id)
    };

    // Adicionar ao lote
    novoLote.boleto = {
        id: novoLote.id,
        valor: novoLote.valorTotal,
        dataVencimento: new Date(new Date(dataCredito).setDate(new Date(dataCredito).getDate() - 2)).toISOString().split('T')[0],
        pix: dadosPagamento.pix,
        linkBoleto: dadosPagamento.boleto,
        status: "PENDENTE"
    };

    dados.lotes.push(novoLote);

    try {
        // Preparar dados para o comprovante
        const dadosLote = {
            id: novoLote.id,
            valorTotal: novoLote.valorTotal,
            dataVencimento: novoLote.boleto.dataVencimento,
            codigoBarras: novoLote.boleto.linkBoleto.linhaDigitavel,
            pagamento: {
                pix: dadosPagamento.pix,
                boleto: dadosPagamento.boleto
            }
        };

        // Gerar imagem do comprovante
        const imagemComprovante = await gerarComprovanteBoleto(dadosLote);
        
        // Fazer upload da imagem para o ImgBB
        const imageUrl = await uploadImageToImgBB(imagemComprovante);

        // Retornar os dados do lote junto com a URL da imagem
        res.status(201).json({
            lote: {
                id: novoLote.id,
                data: novoLote.data,
                status: novoLote.status,
                creditosIds: novoLote.creditosIds,
                valorTotal: novoLote.valorTotal,
                boleto: novoLote.boleto
            },
            creditos: creditosProcessados,
            pagamento: dadosPagamento,
            comprovante: {
                url: imageUrl
            }
        });

    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ 
            erro: 'Erro ao gerar comprovante do lote',
            detalhes: error.message 
        });
    }
});

function gerarPix(valor) {
    return {
        qrCode: `00020126580014BR.GOV.BCB.PIX0136${Math.random().toString(36).substring(2, 38)}5204000053039865802BR5913Beneficiarios6009SAO PAULO62070503***6304${Math.floor(Math.random() * 10000)}`,
        chavePix: `${Math.random().toString(36).substring(2, 15)}@pix.com`,
        valor: valor,
        beneficiario: "Sistema de Beneficiários LTDA",
        identificador: `PGTO${Math.floor(Math.random() * 1000000)}`
    };
}

function gerarLinkBoleto(loteId) {
    return {
        url: `http://localhost:3000/boletos/download/${loteId}/${Math.random().toString(36).substring(2, 15)}.pdf`,
        linhaDigitavel: `23793.${Math.random().toString().slice(2,7)} ${Math.random().toString().slice(2,7)}.${Math.random().toString().slice(2,7)} ${Math.random().toString().slice(2,7)}.${Math.random().toString().slice(2,7)} ${Math.floor(Math.random() * 9)} ${Math.random().toString().slice(2,7)}`,
    };
}

async function gerarComprovanteBoleto(dadosLote) {
    const canvas = createCanvas(1200, 1200);
    const ctx = canvas.getContext('2d');
    const radius = 20;
    
    // Ajustando as dimensões do conteúdo para centralizar
    const conteudoLargura = 800;  // Largura do conteúdo
    const margemLateral = (1200 - conteudoLargura) / 2;  // Calcula margem para centralizar

    // Carregar o ícone
    const icone = await loadImage(path.join(__dirname, 'assets', 'alelo.png'));

    // Função auxiliar para desenhar retângulo com bordas arredondadas
    function roundRect(x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    // Configurar fundo branco para borda externa
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(margemLateral, 0, conteudoLargura, 1200);

    // Desenhar fundo verde escuro com bordas arredondadas
    ctx.fillStyle = CORES.fundo;
    roundRect(margemLateral + 20, 20, conteudoLargura - 40, 1160, radius);
    ctx.fill();

    // Adicionar borda externa branca com bordas arredondadas
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    roundRect(margemLateral + 5, 5, conteudoLargura - 10, 1190, radius);
    ctx.stroke();

    // Adicionar borda interna com bordas arredondadas
    ctx.strokeStyle = CORES.borda;
    ctx.lineWidth = 2;
    roundRect(margemLateral + 30, 30, conteudoLargura - 60, 1140, radius);
    ctx.stroke();

    // Ajustar a faixa verde limão do cabeçalho
    ctx.fillStyle = CORES.primaria;
    ctx.beginPath();
    // Começa do canto inferior esquerdo
    ctx.moveTo(margemLateral + 30, 110);
    // Sobe pela esquerda até o raio da curva
    ctx.lineTo(margemLateral + 30, 30 + radius);
    // Curva superior esquerda
    ctx.quadraticCurveTo(margemLateral + 30, 30, margemLateral + 30 + radius, 30);
    // Linha superior
    ctx.lineTo(margemLateral + conteudoLargura - 30 - radius, 30);
    // Curva superior direita
    ctx.quadraticCurveTo(margemLateral + conteudoLargura - 30, 30, margemLateral + conteudoLargura - 30, 30 + radius);
    // Desce pela direita
    ctx.lineTo(margemLateral + conteudoLargura - 30, 110);
    // Fecha o caminho
    ctx.lineTo(margemLateral + 30, 110);
    ctx.closePath();
    ctx.fill();

    // Ajustar posição do ícone para acompanhar a nova largura
    const iconSize = 60;
    ctx.drawImage(icone, margemLateral + conteudoLargura - 120, 30, iconSize, iconSize);

    // Título do comprovante em verde escuro
    ctx.fillStyle = CORES.secundaria;
    ctx.font = 'bold 32px Arial';
    ctx.fillText('Comprovante de Pedido', margemLateral + 50, 70);

    // Data e hora atual
    const dataAtual = new Date().toLocaleString('pt-BR');
    ctx.fillStyle = CORES.texto; // Texto branco no fundo verde
    ctx.font = '14px Arial';
    ctx.fillText(`Data/Hora: ${dataAtual}`, margemLateral + 50, 170);

    // Título dos dados em verde limão
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = CORES.primaria; // Verde limão para "Dados do Pagamento"
    ctx.fillText('Dados do Pagamento', margemLateral + 50, 250);

    // Caixa de informações com bordas arredondadas
    ctx.fillStyle = CORES.secundaria;
    roundRect(margemLateral + 50, 270, conteudoLargura - 100, 200, 10);
    ctx.fill();
    ctx.strokeStyle = CORES.borda;
    roundRect(margemLateral + 50, 270, conteudoLargura - 100, 200, 10);
    ctx.stroke();

    // Labels
    ctx.fillStyle = CORES.texto;
    ctx.font = '16px Arial';
    ctx.fillText('ID do Lote:', margemLateral + 70, 300);
    ctx.fillText('Valor Total:', margemLateral + 70, 340);
    ctx.fillText('Vencimento:', margemLateral + 70, 380);
    ctx.fillText('Código de Barras:', margemLateral + 70, 420);

    // Valores
    ctx.fillStyle = CORES.primaria;
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`#${dadosLote.id}`, margemLateral + 220, 300);
    ctx.fillText(`R$ ${dadosLote.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margemLateral + 220, 340);
    ctx.fillText(new Date(dadosLote.dataVencimento).toLocaleDateString('pt-BR'), margemLateral + 220, 380);
    ctx.fillText(dadosLote.codigoBarras, margemLateral + 220, 420);

    // Seção PIX
    ctx.fillStyle = CORES.primaria;
    ctx.font = 'bold 18px Arial';
    ctx.fillText('Dados do PIX', margemLateral + 50, 500);

    // Labels PIX
    ctx.fillStyle = CORES.texto;
    ctx.font = '16px Arial';
    ctx.fillText('Chave PIX:', margemLateral + 70, 530);
    ctx.fillText('Beneficiário:', margemLateral + 70, 560);
    ctx.fillText('Identificador:', margemLateral + 70, 590);
    ctx.fillText('QR Code:', margemLateral + 70, 620);

    // Valores PIX
    ctx.fillStyle = CORES.primaria;
    ctx.font = 'bold 16px Arial';
    ctx.fillText(dadosLote.pagamento.pix.chavePix, margemLateral + 220, 530);
    ctx.fillText(dadosLote.pagamento.pix.beneficiario, margemLateral + 220, 560);
    ctx.fillText(dadosLote.pagamento.pix.identificador, margemLateral + 220, 590);

    // QR Code com bordas arredondadas
    // Primeiro desenhar o fundo branco
    ctx.fillStyle = '#FFFFFF';
    roundRect(margemLateral + 550, 500, 150, 150, 10);
    ctx.fill();
    
    // Depois a borda
    ctx.strokeStyle = CORES.borda;
    roundRect(margemLateral + 550, 500, 150, 150, 10);
    ctx.stroke();
    
    // Desenhar QR Code falso
    const qrSize = 150;
    const cellSize = 10;
    const startX = margemLateral + 550;
    const startY = 500;

    // Fundo branco para o QR Code
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(startX, startY, qrSize, qrSize);

    // Desenhar padrão de QR Code
    ctx.fillStyle = '#000000';
    for (let i = 0; i < qrSize/cellSize; i++) {
        for (let j = 0; j < qrSize/cellSize; j++) {
            if (Math.random() > 0.5) {
                ctx.fillRect(
                    startX + (i * cellSize), 
                    startY + (j * cellSize), 
                    cellSize, 
                    cellSize
                );
            }
        }
    }

    // Adicionar quadrados de posicionamento do QR Code
    ctx.fillStyle = '#000000';
    // Superior esquerdo
    ctx.fillRect(startX + 10, startY + 10, 30, 30);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(startX + 15, startY + 15, 20, 20);
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 20, startY + 20, 10, 10);

    // Superior direito
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 110, startY + 10, 30, 30);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(startX + 115, startY + 15, 20, 20);
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 120, startY + 20, 10, 10);

    // Inferior esquerdo
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 10, startY + 110, 30, 30);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(startX + 15, startY + 115, 20, 20);
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 20, startY + 120, 10, 10);

    ctx.fillStyle = CORES.texto;
    ctx.font = '12px Arial';
    ctx.fillText('QR Code PIX', margemLateral + 590, 670);

    // Seção Boleto
    ctx.fillStyle = CORES.primaria;
    ctx.font = 'bold 18px Arial';
    ctx.fillText('Dados do Boleto', margemLateral + 50, 700);

    // Labels Boleto
    ctx.fillStyle = CORES.texto;
    ctx.font = '16px Arial';
    ctx.fillText('Linha Digitável:', margemLateral + 70, 730);

    // Valores Boleto
    ctx.fillStyle = CORES.primaria;
    ctx.font = 'bold 14px Arial';
    ctx.fillText(dadosLote.pagamento.boleto.linhaDigitavel, margemLateral + 220, 730);

    // Mensagens de autenticação
    ctx.fillStyle = CORES.texto;
    ctx.font = '14px Arial';
    ctx.fillText('Este documento é uma representação digital do comprovante de pagamento.', margemLateral + 50, 820);
    ctx.fillText('A autenticação pode ser verificada através do código de validação.', margemLateral + 50, 840);

    // Código de autenticação
    ctx.fillStyle = CORES.primaria;
    ctx.font = 'bold 16px Arial';
    ctx.fillText('Código de Autenticação:', margemLateral + 50, 900);
    ctx.fillStyle = CORES.texto;
    ctx.font = '16px Arial';
    ctx.fillText(gerarCodigoAutenticacao(), margemLateral + 270, 900);

    // Rodapé
    ctx.fillStyle = CORES.texto;
    ctx.font = '14px Arial';
    ctx.fillText('Documento gerado eletronicamente.', margemLateral + 50, 950);
    ctx.fillText('Este comprovante tem validade fiscal.', margemLateral + 50, 970);

    return canvas.toBuffer('image/png');
}

function gerarCodigoAutenticacao() {
    return Array(4).fill(0).map(() => 
        Math.random().toString(36).substring(2, 6).toUpperCase()
    ).join('-');
}

// Função para formatar CPF
function formatarCPF(cpf) {
    const numeros = cpf.replace(/\D/g, '');
    return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Listar todos os beneficiários
app.get('/beneficiarios', (req, res) => {
    const { nome, cpf } = req.query;
    let beneficiariosFiltrados = [...dados.beneficiarios];

    if (nome) {
        beneficiariosFiltrados = beneficiariosFiltrados.filter(b => 
            b.nomeCompleto.toLowerCase().includes(nome.toLowerCase())
        );
    }

    if (cpf) {
        const cpfFormatado = formatarCPF(cpf);
        beneficiariosFiltrados = beneficiariosFiltrados.filter(b => 
            b.cpf.includes(cpfFormatado)
        );
    }

    res.json(beneficiariosFiltrados);
});

// Buscar beneficiário por ID
app.get('/beneficiarios/:id', (req, res) => {
    const beneficiario = dados.beneficiarios.find(b => b.id === req.params.id);
    if (!beneficiario) {
        return res.status(404).json({ mensagem: "Beneficiário não encontrado" });
    }
    res.json(beneficiario);
});

// Incluir novo beneficiário
app.post('/beneficiarios', (req, res) => {
    const { nomeCompleto, cpf } = req.body;

    if (!nomeCompleto || !cpf) {
        return res.status(400).json({ mensagem: "Nome completo e CPF são obrigatórios" });
    }

    const cpfFormatado = formatarCPF(cpf);

    const cpfExistente = dados.beneficiarios.some(b => b.cpf === cpfFormatado);
    if (cpfExistente) {
        return res.status(400).json({ mensagem: "CPF já cadastrado" });
    }

    const novoBeneficiario = {
        id: uuidv4(),
        nomeCompleto,
        cpf: cpfFormatado,
        creditos: []
    };

    dados.beneficiarios.push(novoBeneficiario);
    res.status(201).json(novoBeneficiario);
});

// Editar beneficiário
app.put('/beneficiarios/:id', (req, res) => {
    const { nomeCompleto, cpf } = req.body;
    const id = req.params.id;
    
    const beneficiarioIndex = dados.beneficiarios.findIndex(b => b.id === id);
    if (beneficiarioIndex === -1) {
        return res.status(404).json({ mensagem: "Beneficiário não encontrado" });
    }

    let cpfFormatado = undefined;
    if (cpf) {
        cpfFormatado = formatarCPF(cpf);
        
        const cpfExistente = dados.beneficiarios.some(b => b.cpf === cpfFormatado && b.id !== id);
        if (cpfExistente) {
            return res.status(400).json({ mensagem: "CPF já cadastrado para outro beneficiário" });
        }
    }

    dados.beneficiarios[beneficiarioIndex] = {
        ...dados.beneficiarios[beneficiarioIndex],
        nomeCompleto: nomeCompleto || dados.beneficiarios[beneficiarioIndex].nomeCompleto,
        cpf: cpfFormatado || dados.beneficiarios[beneficiarioIndex].cpf
    };

    res.json(dados.beneficiarios[beneficiarioIndex]);
});

// Excluir beneficiário
app.delete('/beneficiarios/:id', (req, res) => {
    const id = req.params.id;
    const beneficiarioIndex = dados.beneficiarios.findIndex(b => b.id === id);
    
    if (beneficiarioIndex === -1) {
        return res.status(404).json({ mensagem: "Beneficiário não encontrado" });
    }

    const temCreditosPendentes = dados.beneficiarios[beneficiarioIndex].creditos
        .some(c => c.status === "PENDENTE");

    if (temCreditosPendentes) {
        return res.status(400).json({ 
            mensagem: "Não  possível excluir beneficiário com créditos pendentes" 
        });
    }

    dados.beneficiarios.splice(beneficiarioIndex, 1);
    
    if (dados.boletos && dados.boletos.length > 0) {
        dados.boletos = dados.boletos.filter(b => b.beneficiarioId !== id);
    }

    res.status(204).send();
});

// Listar lotes de crédito
app.get('/lotes', (req, res) => {
    res.json(dados.lotes);
});

// Buscar lote específico com seus créditos
app.get('/lotes/:id', (req, res) => {
    const lote = dados.lotes.find(l => l.id === req.params.id);
    
    if (!lote) {
        return res.status(404).json({ mensagem: "Lote não encontrado" });
    }

    const creditosDoLote = dados.beneficiarios.flatMap(beneficiario => 
        beneficiario.creditos.filter(credito => credito.loteId === lote.id)
            .map(credito => ({
                ...credito,
                beneficiario: {
                    id: beneficiario.id,
                    nomeCompleto: beneficiario.nomeCompleto,
                    cpf: beneficiario.cpf
                }
            }))
    );

    res.json({
        ...lote,
        creditos: creditosDoLote
    });
});

// Rota para download do boleto
app.get('/boletos/download/:loteId/:filename', (req, res) => {
    const { loteId } = req.params;
    const lote = dados.lotes.find(l => l.id === loteId);
    
    if (!lote) {
        return res.status(404).json({ mensagem: "Boleto não encontrado" });
    }

    // Criando um PDF fake com dados do boleto
    const boletoPDF = `
        %PDF-1.3
        1 0 obj
        <<
            /Type /Catalog
            /Pages 2 0 R
        >>
        endobj
        2 0 obj
        <<
            /Type /Pages
            /Kids [3 0 R]
            /Count 1
        >>
        endobj
        3 0 obj
        <<
            /Type /Page
            /Parent 2 0 R
            /Resources <<
                /Font <<
                    /F1 4 0 R
                >>
            >>
            /MediaBox [0 0 612 792]
            /Contents 5 0 R
        >>
        endobj
        4 0 obj
        <<
            /Type /Font
            /Subtype /Type1
            /Name /F1
            /BaseFont /Helvetica
        >>
        endobj
        5 0 obj
        << /Length 200 >>
        stream
            BT
                /F1 16 Tf
                50 700 Td
                (BOLETO BANCÁRIO - SISTEMA DE BENEFICIÁRIOS) Tj
                0 -50 Td
                (Valor: R$ ${lote.boleto.valor.toFixed(2)}) Tj
                0 -30 Td
                (Vencimento: ${lote.boleto.dataVencimento}) Tj
                0 -30 Td
                (Linha Digitável: ${lote.boleto.linkBoleto.linhaDigitavel}) Tj
            ET
        endstream
        endobj
        xref
        trailer
        <<
            /Size 6
            /Root 1 0 R
        >>
        startxref
        0
        %%EOF
    `;

    // Configurar headers para download do PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=boleto-lote-${loteId}.pdf`);
    
    // Enviar o PDF
    res.send(Buffer.from(boletoPDF));
});

// Função para fazer upload da imagem para o ImgBB
async function uploadImageToImgBB(imageBuffer) {
    try {
        const formData = new FormData();
        formData.append('image', imageBuffer.toString('base64'));

        const response = await axios.post('https://api.imgbb.com/1/upload', formData, {
            params: {
                key: 'f5a2d4a2ff156b1b0fa1b5d339dcef9e'
            },
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });

        return response.data.data.url;
    } catch (error) {
        console.error('Erro ao fazer upload da imagem:', error);
        throw new Error('Falha ao fazer upload da imagem');
    }
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
}); 