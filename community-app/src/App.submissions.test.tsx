import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { App } from './App'
import { AuthContext, type AuthContextValue } from './auth/AuthProvider'
vi.mock('./pages/BenefitSubmissionPage',()=>({BenefitSubmissionPage:({search,currentPath}:{search:string;currentPath:string})=><main><h1>submission route</h1><p>{search}</p><p>{currentPath}</p></main>}))
vi.mock('./pages/MyBenefitSubmissionsPage',()=>({MyBenefitSubmissionsPage:({currentPath}:{currentPath:string})=><main><h1>owner submissions route</h1><p>{currentPath}</p></main>}))
const auth={loading:false,pending:false,session:{} as never,user:{id:'11111111-1111-4111-8111-111111111111'} as never,error:null,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn()} as AuthContextValue
it.each([
 ['/community/benefits/submit/','?companyId=KR-BIZ-1234567890','#form','submission route'],
 ['/community/benefits/my-submissions/','?from=nav','#top','owner submissions route'],
])('dispatches canonical authenticated route %s lazily with full path',async(pathname,search,hash,heading)=>{render(<AuthContext.Provider value={auth}><App pathname={pathname} search={search} hash={hash}/></AuthContext.Provider>);expect(await screen.findByRole('heading',{name:heading})).toBeVisible();expect(screen.getByText(`${pathname}${search}${hash}`)).toBeVisible()})
