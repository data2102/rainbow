여기는 비워두어도 됩니다. 비어 있으면 이 단계 자체가 빠집니다.

"게임 폴더 맨 위에 그대로 얹을 것"이 있으면 넣는 자리입니다.
예를 들면:

  - dgVoodoo2      (D3D8.dll, D3D9.dll, D3DImm.dll, dgVoodoo.conf,
                    dgVoodooCpl.exe, 그리고 3Dfx\ MS\ Doc\ 폴더)
  - DDrawCompat    (ddraw.dll, DDrawCompat-RainbowSix.ini)
  - 추가 맵         (sherman.kmp, Sherman.txt, ShermanScreenShot1.bmp 등)
  - 그 밖에 게임 폴더에 넣어두는 파일들


게임 폴더 기준으로 있어야 할 자리 그대로 넣으세요.

  payload\extra\D3D8.dll          ->  ...\Tom Clancy's Rainbow Six\D3D8.dll
  payload\extra\MS\x86\...        ->  ...\Tom Clancy's Rainbow Six\MS\x86\...


왜 필요한가:

  레인보우식스는 1998년 게임이라 요즘 윈도우/그래픽카드에서 화면이
  안 나오거나 튕기는 일이 있습니다. dgVoodoo2 와 DDrawCompat 이 그
  사이를 메워주는 것들입니다.

  지금 게임이 잘 돌고 있는 PC의 게임 폴더에 이런 파일들이 있다면,
  그것을 받는 사람에게도 똑같이 넣어줘야 같은 화면이 나옵니다.
