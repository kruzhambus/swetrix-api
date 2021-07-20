import React from 'react'
import { useDispatch } from 'react-redux'

import { authActions } from 'redux/actions/auth'
import { errorsActions } from 'redux/actions/errors'
import { alertsActions } from 'redux/actions/alerts'
import { getCookie, setCookie } from 'utils/cookie'
import { confirmEmail, exportUserData } from 'api'

import UserSettings from './UserSettings'

const UserSettingsContainer = () => {
  const dispatch = useDispatch()

  const onDelete = () => {
    dispatch(
      authActions.deleteAccountAsync(
        (error) => dispatch(
          errorsActions.deleteAccountFailed(error.description)
        )
      )
    )
  }

  const onExport = async () => {
    try {
      await exportUserData()
      // TODO: Use cookies to make sure user is not able to request more than 1 request per day
      dispatch(alertsActions.accountUpdated('The GDPR data report has been sent to your email address'))
    } catch (e) {
      dispatch(errorsActions.updateProfileFailed(e))
    }
  }

  const onSubmit = (data) => {
    delete data.repeat
    for (let key in data) {
      if (data[key] === '') {
        delete data[key]
      }
    }

    dispatch(
      authActions.updateUserProfileAsync(
        data,
        () => dispatch(
          alertsActions.accountUpdated('Your account settings have been updated!')
        )
      )
    );
  }

  const onEmailConfirm = async (errorCallback) => {
    if (getCookie('confirmation_timeout')) {
      dispatch(errorsActions.updateProfileFailed('An email has already been sent, check your mailbox or try again in a few minutes'))
      return
    }

    try {
      const res = await confirmEmail()

      if (res) {
        setCookie('confirmation_timeout', true, 600)
        dispatch(alertsActions.accountUpdated('An account confirmation link has been sent to your email'))
      } else {
        errorCallback('Unfortunately, you\'ve ran out of your email confirmation requests.\nPlease make sure you are able to receive e-mails and check your SPAM folder again for messages.\nYou may try to use a different email address or contact our customer support service.')
      }
    } catch (e) {
      dispatch(errorsActions.updateProfileFailed(e))
    }
  }

  return (
    <UserSettings
      onDelete={onDelete}
      onExport={onExport}
      onSubmit={onSubmit}
      onEmailConfirm={onEmailConfirm}
    />
  )
}

export default UserSettingsContainer
