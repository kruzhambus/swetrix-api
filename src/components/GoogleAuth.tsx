import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { googleAuth } from 'api'
import Button from 'ui/Button'
import GoogleGSVG from 'ui/icons/GoogleG'

const googleScriptSrc = 'https://accounts.google.com/gsi/client'
const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID

const loadScript = (src: string): Promise<any> => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src='${src}']`)) {
    resolve(null)
  }

  const script = document.createElement('script')
  script.src = src
  script.onload = resolve
  script.onerror = reject
  document.body.appendChild(script)
})

interface IGoogleAuth {
  setIsLoading: (isLoading: boolean) => void,
}

const GoogleAuth: React.FC<IGoogleAuth> = ({ setIsLoading }) => {
  const { t } = useTranslation()
  const actualGoogleButton = useRef(null)

  const handleCredentialResponse = async (response: any) => {
    const result = await googleAuth({ token: response.credential })
    console.log(result) // should be { user, access_token, refresh_token }

    setIsLoading(false)
  }

  const renderGoogleLoginButton = async () => {
    try {
      await loadScript(googleScriptSrc)

      // @ts-ignore
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
      })

      // @ts-ignore
      window.google.accounts.id.renderButton(
        actualGoogleButton.current,
        { theme: 'outline', size: 'large' },
      )
    } catch (error) {
      // todo: display error notification
      console.error(error)
    }
  }

  const clickGoogleLoginButton = () => {
    if (actualGoogleButton.current) {
      // @ts-ignore
      const iframe = actualGoogleButton.current.querySelector('iframe')
      // Emulating the click on an actial 'Sign in with Google' button
      iframe.nextElementSibling.click()
    }
  }

  const googleLogin = async () => {
    setIsLoading(true)
    await renderGoogleLoginButton()
    clickGoogleLoginButton()
  }

  return (
    <div>
      <Button
        className='mr-2 border-indigo-100 dark:text-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600'
        onClick={googleLogin}
        secondary
        regular
      >
        <>
          <GoogleGSVG className='w-5 h-5 mr-2' />
          {t('auth.common.continueWithGoogle')}
        </>
      </Button>
      <div
        className='hidden'
        ref={actualGoogleButton}
      />
    </div>
  )
}

export default GoogleAuth
