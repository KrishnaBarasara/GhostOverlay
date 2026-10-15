!macro customHeader
  ; CRITICAL: This forces the installer to name the destination folder "GhostOverlay"
  !define /redef APP_FILENAME "GhostOverlay"
!macroend

!macro customInstall
  ; 1. Overwrite the Desktop Shortcut to use the real GhostOverlay name
  CreateShortCut "$DESKTOP\GhostOverlay.lnk" "$INSTDIR\Windows Widget Host.exe" "" "$INSTDIR\app_icon.ico" 0
  
  ; 2. Overwrite the Start Menu Shortcut to use the real GhostOverlay name
  CreateShortCut "$SMPROGRAMS\GhostOverlay.lnk" "$INSTDIR\Windows Widget Host.exe" "" "$INSTDIR\app_icon.ico" 0
!macroend
