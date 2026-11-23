import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import { BenefitClaimPage } from './BenefitClaimPage'
import type { BenefitClaimRepository } from '../data/benefitClaimRepository'
import type { BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'

const auth={loading:false,pending:false,session:null,user:null,error:null,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn(()=>false)} satisfies AuthContextValue
describe('BenefitClaimPage',()=>{
 it('shows only a Google login gate while signed out and preserves the canonical company return hint',()=>{render(<AuthContext.Provider value={auth}><BenefitClaimPage repository={{} as BenefitClaimRepository} directoryRepository={{} as BenefitDirectoryRepository} search="?company=KR-BIZ-1234567890"/></AuthContext.Provider>);expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);expect(screen.getByRole('button',{name:'Google로 로그인하고 계속'})).toBeInTheDocument();expect(screen.queryByLabelText('제목')).not.toBeInTheDocument()})
})
