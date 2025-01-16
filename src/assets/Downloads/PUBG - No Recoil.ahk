#NoEnv
#Persistent
Return

; Suspende/ativa o script com a tecla '
*~'::Suspend

; Inicializa a variável de velocidade como 0 (desativado)
xdel := 0

; Define a velocidade ao pressionar as teclas F1, F2, etc.
*~F1::xdel := 2 ; Velocidade lenta
*~F2::xdel := 5 ; Velocidade média
*~F3::xdel := 10 ; Velocidade rápida

; Abaixa a mira ao segurar o botão esquerdo do mouse
*~LButton::
if (xdel = 0) ; Verifica se a funcionalidade está desativada
    return

while GetKeyState("LButton", "P") ; Enquanto o botão estiver pressionado
{
    mouseXY(0, xdel) ; Move o mouse para baixo com a velocidade definida
    Sleep, 20 ; Controla a taxa de movimento (aumente para desacelerar)
}
return

; Função para mover o mouse
mouseXY(x, y)
{
    DllCall("mouse_event", "UInt", 1, "Int", x, "Int", y, "UInt", 0, "Int", 0)
}
