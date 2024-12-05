const express = require('express');
const cors = require('cors');
const dados = require('./data/mock');

const app = express();

app.use(cors());
app.use(express.json());

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
        beneficiariosFiltrados = beneficiariosFiltrados.filter(b => 
            b.cpf.includes(cpf)
        );
    }

    res.json(beneficiariosFiltrados);
});

// Buscar beneficiário por ID
app.get('/beneficiarios/:id', (req, res) => {
    const beneficiario = dados.beneficiarios.find(b => b.id === parseInt(req.params.id));
    if (!beneficiario) {
        return res.status(404).json({ mensagem: "Beneficiário não encontrado" });
    }
    res.json(beneficiario);
});

// Incluir novo beneficiário
app.post('/beneficiarios', (req, res) => {
    const { nomeCompleto, cpf } = req.body;

    // Validações básicas
    if (!nomeCompleto || !cpf) {
        return res.status(400).json({ mensagem: "Nome completo e CPF são obrigatórios" });
    }

    // Verificar se CPF já existe
    const cpfExistente = dados.beneficiarios.some(b => b.cpf === cpf);
    if (cpfExistente) {
        return res.status(400).json({ mensagem: "CPF já cadastrado" });
    }

    const novoBeneficiario = {
        id: dados.beneficiarios.length + 1,
        nomeCompleto,
        cpf,
        creditos: []
    };

    dados.beneficiarios.push(novoBeneficiario);
    res.status(201).json(novoBeneficiario);
});

// Editar beneficiário
app.put('/beneficiarios/:id', (req, res) => {
    const { nomeCompleto, cpf } = req.body;
    const id = parseInt(req.params.id);
    
    const beneficiarioIndex = dados.beneficiarios.findIndex(b => b.id === id);
    if (beneficiarioIndex === -1) {
        return res.status(404).json({ mensagem: "Beneficiário não encontrado" });
    }

    // Verificar se o novo CPF já existe em outro beneficiário
    const cpfExistente = dados.beneficiarios.some(b => b.cpf === cpf && b.id !== id);
    if (cpfExistente) {
        return res.status(400).json({ mensagem: "CPF já cadastrado para outro beneficiário" });
    }

    dados.beneficiarios[beneficiarioIndex] = {
        ...dados.beneficiarios[beneficiarioIndex],
        nomeCompleto: nomeCompleto || dados.beneficiarios[beneficiarioIndex].nomeCompleto,
        cpf: cpf || dados.beneficiarios[beneficiarioIndex].cpf
    };

    res.json(dados.beneficiarios[beneficiarioIndex]);
});

// Excluir beneficiário
app.delete('/beneficiarios/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const beneficiarioIndex = dados.beneficiarios.findIndex(b => b.id === id);
    
    if (beneficiarioIndex === -1) {
        return res.status(404).json({ mensagem: "Beneficiário não encontrado" });
    }

    // Verificar se existem créditos pendentes
    const temCreditosPendentes = dados.beneficiarios[beneficiarioIndex].creditos
        .some(c => c.status === "PENDENTE");

    if (temCreditosPendentes) {
        return res.status(400).json({ 
            mensagem: "Não é possível excluir beneficiário com créditos pendentes" 
        });
    }

    // Remover beneficiário
    dados.beneficiarios.splice(beneficiarioIndex, 1);
    
    // Remover boletos associados (se existirem)
    if (dados.boletos && dados.boletos.length > 0) {
        dados.boletos = dados.boletos.filter(b => b.beneficiarioId !== id);
    }

    res.status(204).send();
});

// Atribuir créditos a beneficiários
app.post('/lote-creditos', (req, res) => {
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
        id: dados.lotes.length + 1,
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

    // Retorno formatado
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
        pagamento: dadosPagamento
    });
});

// Listar lotes de crédito
app.get('/lotes', (req, res) => {
    res.json(dados.lotes);
});

// Buscar lote específico com seus créditos
app.get('/lotes/:id', (req, res) => {
    const lote = dados.lotes.find(l => l.id === parseInt(req.params.id));
    
    if (!lote) {
        return res.status(404).json({ mensagem: "Lote não encontrado" });
    }

    // Buscar todos os créditos do lote
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

function gerarPix(valor) {
    // Simulando um payload PIX
    return {
        qrCode: `00020126580014BR.GOV.BCB.PIX0136${Math.random().toString(36).substring(2, 38)}5204000053039865802BR5913Beneficiarios6009SAO PAULO62070503***6304${Math.floor(Math.random() * 10000)}`,
        chavePix: `${Math.random().toString(36).substring(2, 15)}@pix.com`,
        valor: valor,
        beneficiario: "Sistema de Beneficiários LTDA",
        identificador: `PGTO${Math.floor(Math.random() * 1000000)}`
    };
}

function gerarLinkBoleto(loteId) {
    // Simulando um link para download do boleto
    return {
        url: `http://localhost:3000/boletos/download/${loteId}/${Math.random().toString(36).substring(2, 15)}.pdf`,
        linhaDigitavel: `23793.${Math.random().toString().slice(2,7)} ${Math.random().toString().slice(2,7)}.${Math.random().toString().slice(2,7)} ${Math.random().toString().slice(2,7)}.${Math.random().toString().slice(2,7)} ${Math.floor(Math.random() * 9)} ${Math.random().toString().slice(2,7)}`,
    };
}

// Rota para download do boleto
app.get('/boletos/download/:loteId/:filename', (req, res) => {
    const { loteId } = req.params;
    const lote = dados.lotes.find(l => l.id === parseInt(loteId));
    
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
}); 